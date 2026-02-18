import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile, MarkdownRenderer } from 'obsidian';

interface AISettings {
	apiKey: string;
	model: string;
	baseUrl: string;
	realTimeEnabled: boolean;
	debounceMs: number;
	rateLimitBackoff: number;
	temperature: number;
	autocompleteEnabled: boolean;
	autocompleteDebounceMs: number;
	autocompleteMaxTokens: number;
}

interface GrammarSuggestion {
	start: number;
	end: number;
	suggestion: string;
	type: 'grammar' | 'spelling' | 'style';
	original: string;
}

interface AutocompleteSuggestion {
	text: string;
	startPos: number;
}

const DEFAULT_SETTINGS: AISettings = {
	apiKey: '',
	model: 'GLM-4-32B-0414-128K',
	baseUrl: 'https://api.z.ai/api/paas/v4/chat/completions',
	realTimeEnabled: true,
	debounceMs: 1000,
	rateLimitBackoff: 60000,
	temperature: 0.1,
	autocompleteEnabled: true,
	autocompleteDebounceMs: 500,
	autocompleteMaxTokens: 50
}

export default class AIGrammarAssistant extends Plugin {
	settings: AISettings;
	private debounceTimer: NodeJS.Timeout | null = null;
	private activeEditor: Editor | null = null;
	private currentSuggestions: GrammarSuggestion[] = [];
	private suggestionMarkers: HTMLElement[] = [];
	private rateLimitTimer: NodeJS.Timeout | null = null;
	private isRateLimited: boolean = false;
	private autocompleteTimer: NodeJS.Timeout | null = null;
	private currentAutocomplete: AutocompleteSuggestion | null = null;
	private ghostTextElement: HTMLElement | null = null;
	private lastCursorPosition: number = 0;
	private autocompleteHintElement: HTMLElement | null = null;
	private statusBarItem: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();

		// Set up real-time grammar checking
		this.setupRealTimeChecking();

		// Set up autocomplete
		this.setupAutocomplete();

		// Add context menu items
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor, view) => {
				menu.addItem((item) => {
					item.setTitle('Correct Grammar (Selected)')
						.setIcon('spell-check')
						.onClick(async () => {
							await this.correctSelectedText(editor);
						});
				});

				menu.addItem((item) => {
					item.setTitle('Correct Grammar (Document)')
						.setIcon('file-text')
						.onClick(async () => {
							await this.correctEntireDocument(editor);
						});
				});

				menu.addItem((item) => {
					item.setTitle('Improve Writing')
						.setIcon('pencil')
						.onClick(async () => {
							await this.improveWriting(editor);
						});
				});
			})
		);

		// Add command palette commands
		this.addCommand({
			id: 'correct-selected-grammar',
			name: 'Correct Grammar (Selected Text)',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.correctSelectedText(editor);
			}
		});

		this.addCommand({
			id: 'correct-document-grammar',
			name: 'Correct Grammar (Entire Document)',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.correctEntireDocument(editor);
			}
		});

		this.addCommand({
			id: 'improve-writing',
			name: 'Improve Writing (Selected Text)',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.improveWriting(editor);
			}
		});

		this.addCommand({
			id: 'trigger-autocomplete',
			name: 'Trigger AI Autocomplete',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.triggerAutocomplete(editor);
			}
		});

		this.addCommand({
			id: 'accept-autocomplete',
			name: 'Accept Autocomplete Suggestion',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				if (this.currentAutocomplete) {
					this.acceptAutocomplete();
				} else {
					new Notice('No autocomplete suggestion available');
				}
			}
		});

		this.addCommand({
			id: 'debug-autocomplete',
			name: 'Debug: Test Autocomplete',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				new Notice('Testing autocomplete...');
				console.log('=== AUTOCOMPLETE DEBUG ===');
				console.log('API Key set:', !!this.settings.apiKey);
				console.log('Autocomplete enabled:', this.settings.autocompleteEnabled);
				console.log('Rate limited:', this.isRateLimited);
				console.log('Current autocomplete:', this.currentAutocomplete);
				
				const cursor = editor.getCursor();
				const text = editor.getValue();
				const offset = editor.posToOffset(cursor);
				console.log('Cursor position:', offset);
				console.log('Text length:', text.length);
				console.log('Last 50 chars:', text.substring(Math.max(0, offset - 50), offset));
				
				await this.getAutocompleteSuggestion(editor);
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new AISettingTab(this.app, this));

		// Add status bar item
		this.statusBarItem = this.addStatusBarItem();
		this.statusBarItem.setText('');
	}

	onunload() {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}
		if (this.rateLimitTimer) {
			clearTimeout(this.rateLimitTimer);
		}
		if (this.autocompleteTimer) {
			clearTimeout(this.autocompleteTimer);
		}
		this.clearSuggestionMarkers();
		this.clearAutocomplete();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private setupRealTimeChecking() {
		// Track active editor
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf?.view instanceof MarkdownView) {
					this.activeEditor = leaf.view.editor;
					this.clearSuggestionMarkers();
				} else {
					this.activeEditor = null;
					this.clearSuggestionMarkers();
				}
			})
		);

		// Monitor text changes
		this.registerEvent(
			this.app.workspace.on('editor-change', (editor, view) => {
				if (this.settings.realTimeEnabled && this.activeEditor === editor) {
					this.debouncedGrammarCheck(editor);
				}
			})
		);
	}

	private setupAutocomplete() {
		// Monitor text changes for autocomplete
		this.registerEvent(
			this.app.workspace.on('editor-change', (editor, view) => {
				if (this.settings.autocompleteEnabled && this.activeEditor === editor) {
					this.debouncedAutocomplete(editor);
				}
			})
		);

		// Track cursor position
		this.registerEvent(
			this.app.workspace.on('editor-change', (editor, view) => {
				if (this.activeEditor === editor) {
					const cursor = editor.getCursor();
					const newPos = editor.posToOffset(cursor);
					if (newPos !== this.lastCursorPosition) {
						this.lastCursorPosition = newPos;
					}
				}
			})
		);

		// Register keyboard shortcuts for accepting/dismissing autocomplete
		// Use Right Arrow to accept (like GitHub Copilot)
		this.registerDomEvent(document, 'keydown', (evt) => {
			if (this.currentAutocomplete) {
				if (evt.key === 'ArrowRight' && !evt.ctrlKey && !evt.metaKey && !evt.altKey) {
					// Only accept if at end of line (cursor would normally do nothing)
					if (this.activeEditor) {
						const cursor = this.activeEditor.getCursor();
						const line = this.activeEditor.getLine(cursor.line);
						if (cursor.ch >= line.length) {
							evt.preventDefault();
							evt.stopPropagation();
							this.acceptAutocomplete();
						}
					}
				} else if (evt.key === 'Escape') {
					this.clearAutocomplete();
				} else if (evt.key.length === 1 && !evt.ctrlKey && !evt.metaKey && !evt.altKey) {
					// Dismiss on any regular key press
					this.clearAutocomplete();
				}
			}
		});
	}

	private debouncedAutocomplete(editor: Editor) {
		console.log('debouncedAutocomplete called');
		
		if (this.autocompleteTimer) {
			clearTimeout(this.autocompleteTimer);
		}

		// Clear any existing autocomplete
		this.clearAutocomplete();

		// Show status
		this.updateStatusBar('⏳ Getting AI suggestion...');

		this.autocompleteTimer = setTimeout(async () => {
			await this.getAutocompleteSuggestion(editor);
			this.updateStatusBar('');
		}, this.settings.autocompleteDebounceMs);
	}

	private async triggerAutocomplete(editor: Editor) {
		if (!this.settings.autocompleteEnabled) {
			new Notice('Autocomplete is disabled. Enable it in settings.');
			return;
		}
		
		new Notice('Getting suggestion...');
		this.updateStatusBar('⏳ Getting AI suggestion...');
		await this.getAutocompleteSuggestion(editor);
		this.updateStatusBar('');
	}

	private updateStatusBar(text: string) {
		if (this.statusBarItem) {
			this.statusBarItem.setText(text);
		}
	}

	private async getAutocompleteSuggestion(editor: Editor) {
		if (this.isRateLimited || !this.settings.apiKey) {
			console.log('Autocomplete skipped: rate limited or no API key');
			return;
		}

		try {
			const cursor = editor.getCursor();
			const cursorOffset = editor.posToOffset(cursor);
			const fullText = editor.getValue();
			
			console.log('Autocomplete triggered at position:', cursorOffset);
			
			// Get context around cursor (last 300 characters)
			const contextStart = Math.max(0, cursorOffset - 300);
			const contextBefore = fullText.substring(contextStart, cursorOffset);
			
			console.log('Context before cursor:', contextBefore.slice(-50));
			
			// Don't autocomplete if cursor is in the middle of a word (allow triggering after space or punctuation)
			const lastChar = contextBefore.slice(-1);
			const shouldTrigger = !lastChar || /[\s\n.,!?;:]/.test(lastChar);
			
			if (!shouldTrigger) {
				console.log('Autocomplete skipped: cursor in middle of word');
				return;
			}

			// Require at least 10 characters of context
			if (contextBefore.trim().length < 10) {
				console.log('Autocomplete skipped: not enough context');
				return;
			}

			console.log('Calling AI for autocomplete...');
			
			const suggestion = await this.callAIForAutocomplete(contextBefore);
			
			console.log('Received suggestion:', suggestion);
			
			if (suggestion && suggestion.trim()) {
				this.displayAutocomplete(editor, suggestion, cursorOffset);
			} else {
				console.log('No suggestion received');
			}
		} catch (error) {
			console.error('Autocomplete error:', error);
		}
	}

	private async callAIForAutocomplete(contextBefore: string): Promise<string> {
		const response = await fetch(this.settings.baseUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.settings.apiKey}`
			},
			body: JSON.stringify({
				model: this.settings.model,
				messages: [
					{
						role: 'system',
						content: 'You are an autocomplete assistant. Continue the text naturally. Return ONLY the continuation text, nothing else. Do not repeat any of the input text. Keep it concise (1-2 sentences maximum).'
					},
					{
						role: 'user',
						content: `Continue this text: "${contextBefore}"`
					}
				],
				temperature: this.settings.temperature,
				max_tokens: this.settings.autocompleteMaxTokens,
				stop: ['\n\n', '---']
			})
		});

		if (!response.ok) {
			if (response.status === 429) {
				this.handleRateLimit();
			}
			throw new Error(`API error: ${response.status}`);
		}

		const data = await response.json();
		let suggestion = data.choices?.[0]?.message?.content || '';
		
		// Clean up the suggestion
		suggestion = suggestion.trim();
		
		// Remove any leading spaces if context ends with space
		if (contextBefore.endsWith(' ') || contextBefore.endsWith('\n')) {
			suggestion = suggestion.trimStart();
		}
		
		// Limit to reasonable length
		const words = suggestion.split(/\s+/);
		if (words.length > 20) {
			suggestion = words.slice(0, 20).join(' ') + '...';
		}
		
		return suggestion;
	}

	private displayAutocomplete(editor: Editor, suggestion: string, cursorPos: number) {
		this.clearAutocomplete();
		
		console.log('Displaying autocomplete:', suggestion);
		
		// Clean the suggestion
		const cleanSuggestion = suggestion.replace(/^[\r\n]+/, '').trim();
		
		this.currentAutocomplete = {
			text: cleanSuggestion,
			startPos: cursorPos
		};

		// Show hint bar at bottom-right of screen
		this.showAutocompleteHint(cleanSuggestion);
		
		this.updateStatusBar('💡 Suggestion ready - Press → to accept');
	}

	private escapeHtml(text: string): string {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	private showAutocompleteHint(suggestion: string) {
		// Remove any existing hint
		if (this.autocompleteHintElement && this.autocompleteHintElement.parentNode) {
			this.autocompleteHintElement.parentNode.removeChild(this.autocompleteHintElement);
		}

		// Create hint bar - make it more prominent
		this.autocompleteHintElement = document.createElement('div');
		this.autocompleteHintElement.className = 'ai-autocomplete-hint';
		
		// Clean the suggestion for display
		const cleanSuggestion = suggestion.replace(/^[\r\n]+/, '').trim();
		const preview = cleanSuggestion.length > 80 ? cleanSuggestion.substring(0, 80) + '...' : cleanSuggestion;
		
		this.autocompleteHintElement.innerHTML = `
			<div style="display: flex; flex-direction: column; gap: 8px; width: 100%;">
				<div style="display: flex; align-items: center; gap: 8px;">
					<span style="font-size: 18px;">💡</span>
					<span style="font-weight: 600; color: var(--text-normal); font-size: 14px;">AI Suggestion Available</span>
				</div>
				<div style="background: var(--background-secondary); padding: 10px 14px; border-radius: 6px; font-family: var(--font-text); font-size: 14px; line-height: 1.5; color: var(--text-muted); border-left: 3px solid #4a9eff;">
					<span style="color: rgba(128,128,128,0.9); font-style: italic;">${this.escapeHtml(preview)}</span>
				</div>
				<div style="display: flex; gap: 16px; align-items: center; font-size: 12px; color: var(--text-muted);">
					<span><kbd style="background: var(--background-modifier-border); padding: 3px 8px; border-radius: 4px; font-family: monospace; margin-right: 4px;">→</kbd> Accept</span>
					<span><kbd style="background: var(--background-modifier-border); padding: 3px 8px; border-radius: 4px; font-family: monospace; margin-right: 4px;">Esc</kbd> Dismiss</span>
				</div>
			</div>
		`;

		// Style the container
		this.autocompleteHintElement.style.cssText = `
			position: fixed;
			right: 20px;
			bottom: 40px;
			background: var(--background-primary);
			border: 1px solid var(--background-modifier-border);
			border-radius: 8px;
			padding: 12px 16px;
			box-shadow: 0 4px 20px rgba(0,0,0,0.2);
			z-index: 10000;
			max-width: 500px;
			animation: slideIn 0.3s ease-out;
		`;

		document.body.appendChild(this.autocompleteHintElement);
		
		console.log('Autocomplete hint displayed');
	}

	private acceptAutocomplete() {
		if (!this.currentAutocomplete || !this.activeEditor) {
			return;
		}

		const editor = this.activeEditor;
		const cursor = editor.getCursor();
		
		// Clean the suggestion - remove leading newlines
		let textToInsert = this.currentAutocomplete.text;
		textToInsert = textToInsert.replace(/^[\r\n]+/, ''); // Remove leading newlines
		textToInsert = textToInsert.trimStart(); // Remove leading whitespace
		
		console.log('Accepting autocomplete, original:', this.currentAutocomplete.text);
		console.log('Cleaned text to insert:', textToInsert);
		
		// Insert the suggestion at cursor position
		editor.replaceRange(textToInsert, cursor);
		
		// Move cursor to end of inserted text
		const newPos = {
			line: cursor.line,
			ch: cursor.ch + textToInsert.length
		};
		editor.setCursor(newPos);
		
		new Notice('✓ Suggestion accepted');
		this.clearAutocomplete();
	}

	private clearAutocomplete() {
		if (this.autocompleteHintElement && this.autocompleteHintElement.parentNode) {
			this.autocompleteHintElement.parentNode.removeChild(this.autocompleteHintElement);
		}
		this.autocompleteHintElement = null;
		this.currentAutocomplete = null;
		this.ghostTextElement = null;
		
		this.updateStatusBar('');
	}

	private debouncedGrammarCheck(editor: Editor) {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}

		this.debounceTimer = setTimeout(async () => {
			await this.checkGrammarRealTime(editor);
		}, this.settings.debounceMs);
	}

	private async checkGrammarRealTime(editor: Editor) {
		const text = editor.getValue();
		if (!text.trim()) {
			this.clearSuggestionMarkers();
			return;
		}

		if (!this.settings.apiKey) {
			this.clearSuggestionMarkers();
			console.log('API key not set, skipping grammar check');
			return;
		}

		if (this.isRateLimited) {
			console.log('Rate limited, skipping grammar check');
			return;
		}

		try {
			console.log('Starting real-time grammar check...');
			const suggestions = await this.getGrammarSuggestions(text);
			console.log('Suggestions received:', suggestions);
			this.displaySuggestions(editor, suggestions);
		} catch (error) {
			console.error('Real-time grammar check failed:', error);
			this.clearSuggestionMarkers();
			
			// Show user-friendly error
			if (error.message.includes('fetch')) {
				new Notice('Network error: Check your internet connection and API URL');
			} else if (error.message.includes('401') || error.message.includes('403')) {
				new Notice('Authentication error: Check your API key');
			} else if (error.message.includes('404')) {
				new Notice('API endpoint not found: Check your base URL setting');
			} else if (error.message.includes('429') || error.message.includes('rate limit')) {
				this.handleRateLimit();
			} else {
				new Notice('Grammar check failed: ' + error.message);
			}
		}
	}

	private handleRateLimit() {
		this.isRateLimited = true;
		const backoffMs = this.settings.rateLimitBackoff;
		const minutes = Math.ceil(backoffMs / 60000);
		
		new Notice(`Rate limit reached. Pausing for ${minutes} minute(s) to avoid further limits.`);
		
		if (this.rateLimitTimer) {
			clearTimeout(this.rateLimitTimer);
		}
		
		this.rateLimitTimer = setTimeout(() => {
			this.isRateLimited = false;
			console.log('Rate limit cooldown ended, resuming grammar checks');
		}, backoffMs);
	}

	async testApiConnection(): Promise<boolean> {
		if (!this.settings.apiKey) {
			new Notice('Please set your API key first');
			return false;
		}

		try {
			console.log('Testing API connection to:', this.settings.baseUrl);
			
			const response = await fetch(this.settings.baseUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.settings.apiKey}`
				},
				body: JSON.stringify({
					model: this.settings.model,
					messages: [
						{
							role: 'system',
							content: 'You are a helpful AI assistant.'
						},
						{
							role: 'user',
							content: 'Hello, please respond with "OK" to confirm you are working.'
						}
					],
					temperature: this.settings.temperature,
					max_tokens: 50
				})
			});

			console.log('API test response status:', response.status);
			
			if (!response.ok) {
				const errorText = await response.text();
				console.error('API test error:', errorText);
				
				if (response.status === 401) {
					new Notice('Authentication failed: Invalid API key');
				} else if (response.status === 404) {
					new Notice('API endpoint not found: Check your base URL');
				} else if (response.status === 429) {
					new Notice('Rate limit reached: Try again later or upgrade your plan');
					this.handleRateLimit();
				} else if (response.status >= 500) {
					new Notice('Server error: Try again later');
				} else {
					new Notice(`API error (${response.status}): ${errorText}`);
				}
				return false;
			}

			const data = await response.json();
			console.log('API test response:', data);
			
			if (data.choices && data.choices.length > 0) {
				new Notice('API connection successful!');
				return true;
			} else {
				new Notice('Unexpected API response format');
				return false;
			}
		} catch (error) {
			console.error('Connection test failed:', error);
			if (error instanceof Error) {
				if (error.message.includes('fetch')) {
					new Notice('Network error: Check your internet connection and API URL');
				} else {
					new Notice('Connection failed: ' + error.message);
				}
			}
			return false;
		}
	}

	private async getGrammarSuggestions(text: string): Promise<GrammarSuggestion[]> {
		if (this.isRateLimited) {
			throw new Error('Rate limit in effect');
		}

		console.log('Getting grammar suggestions for text length:', text.length);
		
		const response = await fetch(this.settings.baseUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.settings.apiKey}`
			},
			body: JSON.stringify({
				model: this.settings.model,
				messages: [
					{
						role: 'system',
						content: 'You are a grammar checker. Analyze the text for grammar, spelling, and style issues. For each issue found, provide a JSON response with the start position, end position, suggestion text, type (grammar/spelling/style), and original text. Return only the JSON array without explanations. Format: [{"start": 0, "end": 5, "suggestion": "corrected", "type": "grammar", "original": "wrong"}]'
					},
					{
						role: 'user',
						content: `Please analyze this text for grammar and spelling issues: "${text}"`
					}
				],
					temperature: this.settings.temperature,
					max_tokens: 1500
			})
		});

		if (response.status === 429) {
			const errorText = await response.text();
			console.error('Rate limit error:', errorText);
			throw new Error('Rate limit reached for requests');
		}

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`API error: ${response.status}, ${errorText}`);
		}

		const data = await response.json();
		console.log('Grammar suggestions API response:', data);
		
		let content = data.choices?.[0]?.message?.content || '[]';
		console.log('Raw suggestions content:', content);
		
		// Handle different response formats
		if (typeof content === 'string') {
			content = content.trim();
			
			// Try to extract JSON from various formats
			if (!content.startsWith('[') && !content.startsWith('{')) {
				// Look for JSON in the response
				const jsonMatch = content.match(/\[[\s\S]*\]/);
				if (jsonMatch) {
					content = jsonMatch[0];
				}
			}
		}
		
		try {
			const suggestions = JSON.parse(content);
			console.log('Parsed suggestions:', suggestions);
			return Array.isArray(suggestions) ? suggestions : [];
		} catch (error) {
			console.error('Failed to parse suggestions JSON:', error, 'Content was:', content);
			return [];
		}
	}

	private displaySuggestions(editor: Editor, suggestions: GrammarSuggestion[]) {
		this.clearSuggestionMarkers();
		this.currentSuggestions = suggestions;

		// Create suggestion indicators
		suggestions.forEach(suggestion => {
			this.createSuggestionMarker(editor, suggestion);
		});
	}

	private createSuggestionMarker(editor: Editor, suggestion: GrammarSuggestion) {
		// Create a floating suggestion indicator
		const marker = document.createElement('div');
		marker.className = `ai-grammar-suggestion ${suggestion.type}`;
		marker.style.cssText = `
			position: absolute;
			background-color: rgba(255, 165, 0, 0.3);
			border-bottom: 2px wavy #ff6b35;
			cursor: pointer;
			z-index: 100;
			pointer-events: auto;
			padding: 0 2px;
		`;
		
		marker.title = `${suggestion.type}: ${suggestion.suggestion}`;
		
		marker.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.showSuggestionPopup(editor, suggestion, marker);
		});

		// Try to position the marker
		this.positionMarker(editor, marker, suggestion);
		
		this.suggestionMarkers.push(marker);
	}

	private positionMarker(editor: Editor, marker: HTMLElement, suggestion: GrammarSuggestion) {
		try {
			// Get the active view's container
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView) {
				const container = activeView.containerEl.querySelector('.cm-editor');
				if (container) {
					container.appendChild(marker);
				}
			}
		} catch (error) {
			console.error('Failed to position marker:', error);
		}
	}

	private showSuggestionPopup(editor: Editor, suggestion: GrammarSuggestion, target: HTMLElement) {
		// Create popup element
		const popup = document.createElement('div');
		popup.className = 'ai-grammar-popup';
		popup.innerHTML = `
			<div class="ai-grammar-popup-title">Suggestion (${suggestion.type})</div>
			<div class="ai-grammar-popup-text">Change "${suggestion.original}" to "${suggestion.suggestion}"</div>
			<div class="ai-grammar-popup-actions">
				<button class="ai-grammar-popup-button">Apply</button>
				<button class="ai-grammar-popup-button dismiss">Dismiss</button>
			</div>
		`;

		// Position popup near the target
		const rect = target.getBoundingClientRect();
		popup.style.position = 'fixed';
		popup.style.left = `${rect.left}px`;
		popup.style.top = `${rect.bottom + 5}px`;
		popup.style.zIndex = '10000';

		// Add to document
		document.body.appendChild(popup);

		// Handle button clicks
		const applyButton = popup.querySelector('.ai-grammar-popup-button') as HTMLButtonElement;
		const dismissButton = popup.querySelector('.ai-grammar-popup-button.dismiss') as HTMLButtonElement;
		
		if (applyButton) {
			applyButton.addEventListener('click', () => {
				this.applySuggestion(editor, suggestion);
				if (popup.parentNode) {
					document.body.removeChild(popup);
				}
			});
		}

		if (dismissButton) {
			dismissButton.addEventListener('click', () => {
				if (popup.parentNode) {
					document.body.removeChild(popup);
				}
			});
		}

		// Close on outside click
		const closeHandler = (e: MouseEvent) => {
			if (!popup.contains(e.target as Node)) {
				document.body.removeChild(popup);
				document.removeEventListener('click', closeHandler);
			}
		};
		setTimeout(() => document.addEventListener('click', closeHandler), 100);
	}

	private applySuggestion(editor: Editor, suggestion: GrammarSuggestion) {
		try {
			const startPos = editor.offsetToPos(suggestion.start);
			const endPos = editor.offsetToPos(suggestion.end);
			const originalText = editor.getRange(startPos, endPos);
			
			if (originalText === suggestion.original) {
				editor.replaceRange(suggestion.suggestion, startPos, endPos);
				new Notice('Applied suggestion');
			}
		} catch (error) {
			console.error('Failed to apply suggestion:', error);
			new Notice('Failed to apply suggestion');
		}
	}

	private clearSuggestionMarkers() {
		this.suggestionMarkers.forEach(marker => {
			if (marker.parentNode) {
				marker.parentNode.removeChild(marker);
			}
		});
		this.suggestionMarkers = [];
		this.currentSuggestions = [];
	}

	private async callAI(text: string, instruction: string): Promise<string> {
		if (!this.settings.apiKey) {
			new Notice('Please set your API key in the plugin settings');
			return '';
		}

		try {
			console.log('Making API call to:', this.settings.baseUrl);
			console.log('Using model:', this.settings.model);
			console.log('Input text:', text);
			console.log('Instruction:', instruction);
			
			const response = await fetch(this.settings.baseUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.settings.apiKey}`
				},
				body: JSON.stringify({
					model: this.settings.model,
					messages: [
						{
							role: 'system',
							content: instruction
						},
						{
							role: 'user',
							content: text
						}
					],
					temperature: this.settings.temperature,
					max_tokens: 2000
				})
			});

			if (!response.ok) {
				const errorText = await response.text();
				console.error('API Error Response:', errorText);
				
				if (response.status === 429) {
					this.handleRateLimit();
					throw new Error('Rate limit reached for requests');
				}
				
				throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
			}

			const data = await response.json();
			console.log('API Response:', data);
			console.log('Choices:', data.choices);
			console.log('First choice:', data.choices?.[0]);
			console.log('Message content:', data.choices?.[0]?.message?.content);
			
			let result = data.choices?.[0]?.message?.content || text;
			
			// Handle different model response formats
			if (typeof result === 'string') {
				result = result.trim();
			}
			
			console.log('Final processed result:', result);
			return result;
		} catch (error) {
			console.error('AI API Error:', error);
			
			if (error instanceof Error) {
				if (error.message.includes('rate limit')) {
					new Notice('Rate limit reached. Pausing requests temporarily.');
				} else {
					new Notice('Failed to connect to AI service. Please check your settings.');
				}
			}
			
			return text;
		}
	}

	private async correctSelectedText(editor: Editor) {
		const selectedText = editor.getSelection();
		if (!selectedText) {
			new Notice('Please select some text to correct');
			return;
		}

		new Notice('Correcting grammar...');
		const corrected = await this.callAI(selectedText, 'Correct the grammar and spelling of the following text while preserving the original meaning and formatting. Return only the corrected text without explanations.');
		
		if (corrected) {
			// Always replace the selection, even if the text is the same
			editor.replaceSelection(corrected);
			new Notice('Grammar corrected');
		}
	}

	private async correctEntireDocument(editor: Editor) {
		const fullText = editor.getValue();
		if (!fullText.trim()) {
			new Notice('Document is empty');
			return;
		}

		new Notice('Correcting document grammar...');
		const corrected = await this.callAI(fullText, 'Correct the grammar and spelling of the following markdown document while preserving the original formatting, markdown syntax, and meaning. Return only the corrected document without explanations.');
		
		if (corrected && corrected !== fullText) {
			editor.setValue(corrected);
			new Notice('Document grammar corrected');
		}
	}

	private async improveWriting(editor: Editor) {
		const selectedText = editor.getSelection();
		if (!selectedText) {
			new Notice('Please select some text to improve');
			return;
		}

		new Notice('Improving writing...');
		const improved = await this.callAI(selectedText, 'Improve the clarity, style, and flow of the following text while preserving the original meaning and key information. Make it more professional and readable. Return only the improved text without explanations.');
		
		if (improved) {
			// Always replace the selection, even if the text is the same
			editor.replaceSelection(improved);
			new Notice('Writing improved');
		}
	}
}

class AISettingTab extends PluginSettingTab {
	plugin: AIGrammarAssistant;

	constructor(app: App, plugin: AIGrammarAssistant) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'AI Grammar Assistant Settings'});

		new Setting(containerEl)
			.setName('API Key')
			.setDesc('Your AI service API key (for GLM 4.5 Flash)')
			.addText(text => text
				.setPlaceholder('Enter your API key')
				.setValue(this.plugin.settings.apiKey)
				.onChange(async (value) => {
					this.plugin.settings.apiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Model')
			.setDesc('AI model to use')
			.addText(text => text
				.setPlaceholder('glm-4.5-flash')
				.setValue(this.plugin.settings.model)
				.onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Base URL')
			.setDesc('API endpoint URL')
			.addText(text => text
				.setPlaceholder('https://api.z.ai/api/paas/v4/chat/completions')
				.setValue(this.plugin.settings.baseUrl)
				.onChange(async (value) => {
					this.plugin.settings.baseUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Temperature')
			.setDesc('Controls randomness in AI responses (0.0 = deterministic, 1.0 = creative)')
			.addSlider(slider => slider
				.setLimits(0.0, 1.0, 0.1)
				.setValue(this.plugin.settings.temperature)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.temperature = value;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('h3', {text: 'Real-time Grammar Checking'});

		new Setting(containerEl)
			.setName('Enable Real-time Checking')
			.setDesc('Automatically check grammar as you type')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.realTimeEnabled)
				.onChange(async (value) => {
					this.plugin.settings.realTimeEnabled = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Debounce Delay (ms)')
			.setDesc('Delay before checking grammar after typing stops')
			.addSlider(slider => slider
				.setLimits(500, 3000, 100)
				.setValue(this.plugin.settings.debounceMs)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.debounceMs = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Rate Limit Backoff (minutes)')
			.setDesc('How long to pause when rate limit is reached')
			.addSlider(slider => slider
				.setLimits(1, 60, 1)
				.setValue(this.plugin.settings.rateLimitBackoff / 60000)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.rateLimitBackoff = value * 60000;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Test API Connection')
			.setDesc('Test if your API settings are working correctly')
			.addButton(button => button
				.setButtonText('Test Connection')
				.onClick(async () => {
					button.setDisabled(true);
					button.setButtonText('Testing...');
					
					const success = await this.plugin.testApiConnection();
					
					if (success) {
						button.setButtonText('✓ Connected');
						new Notice('API connection successful!');
					} else {
						button.setButtonText('✗ Failed');
						new Notice('API connection failed. Check your settings.');
					}
					
					setTimeout(() => {
						button.setDisabled(false);
						button.setButtonText('Test Connection');
					}, 3000);
				}));

		containerEl.createEl('h3', {text: 'AI Autocomplete / IntelliSense'});

		new Setting(containerEl)
			.setName('Enable Autocomplete')
			.setDesc('Show AI-powered text predictions as you type')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autocompleteEnabled)
				.onChange(async (value) => {
					this.plugin.settings.autocompleteEnabled = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Autocomplete Delay (ms)')
			.setDesc('Delay before showing suggestions after you stop typing')
			.addSlider(slider => slider
				.setLimits(200, 2000, 100)
				.setValue(this.plugin.settings.autocompleteDebounceMs)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.autocompleteDebounceMs = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Max Suggestion Length (tokens)')
			.setDesc('Maximum length of autocomplete suggestions')
			.addSlider(slider => slider
				.setLimits(10, 100, 5)
				.setValue(this.plugin.settings.autocompleteMaxTokens)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.autocompleteMaxTokens = value;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('p', {text: '💡 Press → (Right Arrow) to accept suggestions, Esc to dismiss'});
		containerEl.createEl('p', {text: 'Ghost text will appear in gray at your cursor position'});

		containerEl.createEl('h3', {text: 'How to get started:'});
		containerEl.createEl('p', {text: '1. Get an API key from Zhipu AI (https://z.ai/manage-apikey/apikey-list)'});
		containerEl.createEl('p', {text: '2. Enter your API key above'});
		containerEl.createEl('p', {text: '3. Right-click on any note or selected text to use the AI assistant'});
	}
}