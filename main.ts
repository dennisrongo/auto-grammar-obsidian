import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile, MarkdownRenderer, Modal, SuggestModal } from 'obsidian';
import { AIProvider, ProviderFactory } from './providers';
import { AISettings } from './types';

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
	provider: 'zai',
	apiKeys: {
		zai: '',
		openai: '',
		straico: ''
	},
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
	provider: AIProvider | null = null;
	public straicoproviderModels: { id: string; name: string }[] = [];
	public openaiModels: { id: string; name: string }[] = [];
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
	private isAcceptingAutocomplete: boolean = false;

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
					item.setTitle('Improve Writing (Selected)')
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
				console.log('API Key set:', !!this.getCurrentApiKey());
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
		// Load settings with migration support
		const loadedData = await this.loadData();
		
		// Handle migration from old apiKey format to new apiKeys format
		if (loadedData && loadedData.apiKey && !loadedData.apiKeys) {
			// Migrate existing API key to Z.ai provider (as it was the original)
			loadedData.apiKeys = {
				zai: loadedData.apiKey,
				openai: '',
				straico: ''
			};
			// Remove old apiKey property
			delete loadedData.apiKey;
			// Save the migrated data
			await this.saveData(loadedData);
		}
		
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
		this.initializeProvider();
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.initializeProvider();
	}
	
	private initializeProvider() {
		this.provider = ProviderFactory.createProvider(this.settings.provider);
		if (this.provider) {
			this.provider.setConfiguration(
				this.getCurrentApiKey(),
				this.settings.model,
				this.settings.baseUrl
			);
		}
	}
	
	getCurrentApiKey(): string {
		return this.settings.apiKeys[this.settings.provider as keyof typeof this.settings.apiKeys] || '';
	}
	
	setCurrentApiKey(apiKey: string) {
		this.settings.apiKeys[this.settings.provider as keyof typeof this.settings.apiKeys] = apiKey;
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
		
		// Don't trigger autocomplete if we're in the process of accepting one
		if (this.isAcceptingAutocomplete) {
			console.log('Autocomplete skipped: currently accepting a suggestion');
			return;
		}
		
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
		if (this.isRateLimited || !this.getCurrentApiKey()) {
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
		if (!this.provider) {
			throw new Error('No AI provider configured');
		}
		
		try {
			const suggestion = await this.provider.getAutocompleteSuggestion(
				contextBefore, 
				this.settings.temperature, 
				this.settings.autocompleteMaxTokens
			);
			return suggestion;
		} catch (error: any) {
			if (error.message.includes('429')) {
				this.handleRateLimit();
			}
			throw error;
		}
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

		// Set flag to prevent re-triggering autocomplete
		this.isAcceptingAutocomplete = true;

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
		
		// Reset flag after a short delay to allow editor-change events to settle
		setTimeout(() => {
			this.isAcceptingAutocomplete = false;
		}, 500);
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

		if (!this.getCurrentApiKey()) {
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
			if (error instanceof Error) {
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
		if (!this.getCurrentApiKey()) {
			new Notice('Please set your API key first');
			return false;
		}

		if (!this.provider) {
			new Notice('No AI provider configured');
			return false;
		}

		try {
			console.log('Testing API connection with provider:', this.settings.provider);
			
			const success = await this.provider.testConnection(this.getCurrentApiKey(), this.settings.model);
			
			if (success) {
				new Notice('API connection successful!');
				return true;
			} else {
				new Notice('API connection failed. Check your settings.');
				return false;
			}
		} catch (error) {
			console.error('Connection test failed:', error);
			if (error instanceof Error) {
				if (error.message.includes('fetch')) {
					new Notice('Network error: Check your internet connection and API URL');
				} else if (error.message.includes('429')) {
					new Notice('Rate limit reached: Try again later or upgrade your plan');
					this.handleRateLimit();
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

		if (!this.provider) {
			throw new Error('No AI provider configured');
		}

		console.log('Getting grammar suggestions for text length:', text.length);
		
		try {
			const suggestions = await this.provider.getGrammarSuggestions(text, this.settings.temperature);
			return suggestions;
		} catch (error: any) {
			if (error.message.includes('429') || error.message.includes('rate limit')) {
				throw new Error('Rate limit reached for requests');
			}
			throw error;
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
		if (!this.getCurrentApiKey()) {
			new Notice('Please set your API key in the plugin settings');
			return '';
		}

		if (!this.provider) {
			new Notice('No AI provider configured');
			return text;
		}

		try {
			console.log('Making API call with provider:', this.settings.provider);
			console.log('Using model:', this.settings.model);
			console.log('Input text:', text);
			console.log('Instruction:', instruction);
			
			const result = await this.provider.callAPI(text, instruction, this.settings.temperature, 2000);
			
			console.log('Final processed result:', result);
			return result;
		} catch (error: any) {
			console.error('AI API Error:', error);
			
			if (error instanceof Error) {
				if (error.message.includes('rate limit') || error.message.includes('429')) {
					this.handleRateLimit();
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
		
		// Check if the selection starts/ends with whitespace to preserve it
		const leadingWhitespace = selectedText.match(/^(\s*)/)?.[1] || '';
		const trailingWhitespace = selectedText.match(/(\s*)$/)?.[1] || '';
		
		// Get context before the selection to determine capitalization
		const selectionStart = editor.getCursor('from');
		const selectionEnd = editor.getCursor('to');
		const lineStart = { line: selectionStart.line, ch: 0 };
		const textBeforeSelection = editor.getRange(lineStart, selectionStart);
		
		// Determine if selection is at the start of a sentence
		const isStartOfLine = selectionStart.ch === 0;
		const isAfterSentenceEnd = /[.!?]\s*$/.test(textBeforeSelection);
		const isAfterNewline = /\n\s*$/.test(textBeforeSelection);
		const isStartOfSentence = isStartOfLine || isAfterSentenceEnd || isAfterNewline;
		
		// Get context after selection
		const lineEnd = { line: selectionEnd.line, ch: editor.getLine(selectionEnd.line).length };
		const textAfterSelection = editor.getRange(selectionEnd, lineEnd);
		const isEndOfSentence = /[.!?]$/.test(selectedText.trim()) || textAfterSelection.match(/^\s*[.!?]/);
		
		// Check original capitalization pattern
		const trimmedText = selectedText.trim();
		const startsWithLowercase = /^[a-z]/.test(trimmedText);
		const startsWithUppercase = /^[A-Z]/.test(trimmedText);
		
		const contextInfo = `Context: This text is ${isStartOfSentence ? 'at the START of a sentence' : 'in the MIDDLE of a sentence'}. ` +
			`The original text ${startsWithUppercase ? 'starts with an uppercase letter' : startsWithLowercase ? 'starts with a lowercase letter' : 'does not start with a letter'}.`;
		
		const corrected = await this.callAI(
			trimmedText, 
			'Correct only the grammar and spelling errors in the following text.\n\n' +
			`${contextInfo}\n\n` +
			'IMPORTANT RULES:\n' +
			'1. Return ONLY the corrected text with no explanations or commentary\n' +
			'2. Do NOT add any formatting, markdown, or code blocks\n' +
			'3. Do NOT add or remove line breaks\n' +
			'4. Do NOT change the meaning or structure\n' +
			'5. CAPITALIZATION RULES:\n' +
			'   - If the text is in the MIDDLE of a sentence, keep the first letter lowercase (unless it\'s a proper noun)\n' +
			'   - If the text is at the START of a sentence, capitalize the first letter\n' +
			'   - Preserve proper nouns and acronyms\n' +
			'6. If there are no errors, return the text exactly as is'
		);
		
		if (corrected) {
			// Clean the result
			let cleanedResult = corrected;
			
			// Remove any markdown code blocks if the AI added them
			cleanedResult = cleanedResult.replace(/^```(?:\w*)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
			
			// Remove any "Here's the corrected..." type prefixes
			cleanedResult = cleanedResult.replace(/^(Here'?s? (is )?(the )?correct(ed)? (text|version|grammar)[:.]?\s*)/i, '');
			cleanedResult = cleanedResult.replace(/^(Corrected (text|version|grammar)[:.]?\s*)/i, '');
			
			// Trim extra whitespace but preserve intentional formatting
			cleanedResult = cleanedResult.trim();
			
			// Final check: if original started with lowercase and we're not at sentence start, ensure lowercase
			if (!isStartOfSentence && startsWithLowercase && cleanedResult.length > 0) {
				cleanedResult = cleanedResult.charAt(0).toLowerCase() + cleanedResult.slice(1);
			}
			
			// Restore original leading/trailing whitespace
			const finalResult = leadingWhitespace + cleanedResult + trailingWhitespace;
			
			// Replace the selection
			editor.replaceSelection(finalResult);
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
		const corrected = await this.callAI(
			fullText, 
			'Correct only the grammar and spelling errors in the following markdown document. ' +
			'IMPORTANT RULES:\n' +
			'1. Return ONLY the corrected document with no explanations or commentary\n' +
			'2. Do NOT add any extra formatting or code blocks\n' +
			'3. Preserve ALL markdown syntax exactly (headers, links, bold, italic, lists, code blocks, etc.)\n' +
			'4. Do NOT change the document structure or add/remove sections\n' +
			'5. Preserve the original line breaks and paragraph structure\n' +
			'6. If there are no errors, return the text exactly as is'
		);
		
		if (corrected) {
			// Clean the result
			let cleanedResult = corrected;
			
			// Remove any markdown code blocks if the AI wrapped the response
			cleanedResult = cleanedResult.replace(/^```(?:markdown|md)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
			
			if (cleanedResult !== fullText) {
				editor.setValue(cleanedResult);
				new Notice('Document grammar corrected');
			}
		}
	}

	private async improveWriting(editor: Editor) {
		const selectedText = editor.getSelection();
		if (!selectedText) {
			new Notice('Please select some text to improve');
			return;
		}

		new Notice('Improving writing...');
		
		// Check if the selection starts/ends with whitespace to preserve it
		const leadingWhitespace = selectedText.match(/^(\s*)/)?.[1] || '';
		const trailingWhitespace = selectedText.match(/(\s*)$/)?.[1] || '';
		
		// Get context before the selection to determine capitalization
		const selectionStart = editor.getCursor('from');
		const selectionEnd = editor.getCursor('to');
		const lineStart = { line: selectionStart.line, ch: 0 };
		const textBeforeSelection = editor.getRange(lineStart, selectionStart);
		
		// Determine if selection is at the start of a sentence
		const isStartOfLine = selectionStart.ch === 0;
		const isAfterSentenceEnd = /[.!?]\s*$/.test(textBeforeSelection);
		const isAfterNewline = /\n\s*$/.test(textBeforeSelection);
		const isStartOfSentence = isStartOfLine || isAfterSentenceEnd || isAfterNewline;
		
		// Check original capitalization pattern
		const trimmedText = selectedText.trim();
		const startsWithLowercase = /^[a-z]/.test(trimmedText);
		
		const contextInfo = `Context: This text is ${isStartOfSentence ? 'at the START of a sentence' : 'in the MIDDLE of a sentence'}.`;
		
		const improved = await this.callAI(
			trimmedText,
			'Improve the clarity, style, and flow of the following text.\n\n' +
			`${contextInfo}\n\n` +
			'IMPORTANT RULES:\n' +
			'1. Return ONLY the improved text with no explanations or commentary\n' +
			'2. Do NOT add any formatting, markdown, or code blocks\n' +
			'3. Do NOT add or remove line breaks\n' +
			'4. Preserve the original meaning and key information\n' +
			'5. Make it more professional and readable\n' +
			'6. Do NOT change technical terms or proper nouns\n' +
			'7. CAPITALIZATION RULES:\n' +
			'   - If the text is in the MIDDLE of a sentence, keep the first letter lowercase (unless it\'s a proper noun)\n' +
			'   - If the text is at the START of a sentence, capitalize the first letter'
		);
		
		if (improved) {
			// Clean the result
			let cleanedResult = improved;
			
			// Remove any markdown code blocks if the AI added them
			cleanedResult = cleanedResult.replace(/^```(?:\w*)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
			
			// Remove any prefixes
			cleanedResult = cleanedResult.replace(/^(Here'?s? (is )?(the )?improved (text|version|writing)[:.]?\s*)/i, '');
			cleanedResult = cleanedResult.replace(/^(Improved (text|version|writing)[:.]?\s*)/i, '');
			
			// Trim extra whitespace
			cleanedResult = cleanedResult.trim();
			
			// Final check: if original started with lowercase and we're not at sentence start, ensure lowercase
			if (!isStartOfSentence && startsWithLowercase && cleanedResult.length > 0) {
				cleanedResult = cleanedResult.charAt(0).toLowerCase() + cleanedResult.slice(1);
			}
			
			// Restore original leading/trailing whitespace
			const finalResult = leadingWhitespace + cleanedResult + trailingWhitespace;
			
			editor.replaceSelection(finalResult);
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
	
	async createStraicoModelDropdown(modelSetting: Setting, containerEl: HTMLElement) {
		const currentApiKey = this.plugin.getCurrentApiKey();
		
		// Check if API key exists
		if (!currentApiKey || currentApiKey.trim() === '') {
			modelSetting.setDesc('Please enter an API key first to load available models');
			modelSetting.addText(text => text
				.setPlaceholder('Enter model ID manually')
				.setValue(this.plugin.settings.model)
				.onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				}));
			return;
		}
		
		// Fetch Straico models if not already loaded
		if (this.plugin.straicoproviderModels.length === 0) {
			try {
				// Add loading state
				modelSetting.setDesc('Loading available models...');
				
				if (this.plugin.provider && 'getAvailableModels' in this.plugin.provider) {
					const provider = this.plugin.provider as any; // Type assertion for optional method
					this.plugin.straicoproviderModels = await provider.getAvailableModels(currentApiKey);
				}
			} catch (error) {
				console.error('Failed to load Straico models:', error);
				modelSetting.setDesc('Failed to load models. Please check your API key and try again.');
				// Fall back to text input
				modelSetting.addText(text => text
					.setPlaceholder('Enter model ID manually')
					.setValue(this.plugin.settings.model)
					.onChange(async (value) => {
						this.plugin.settings.model = value;
						await this.plugin.saveSettings();
					}));
				return;
			}
		}
		
		// Create dropdown with available models
		modelSetting.setDesc('Select AI model to use');
		modelSetting.addDropdown(dropdown => {
			// Add available models to dropdown
			this.plugin.straicoproviderModels.forEach(model => {
				dropdown.addOption(model.id, model.name);
			});
			
			// Add custom option for manual model entry
			dropdown.addOption('custom', 'Custom (enter model ID manually)');
			
			// Set current value
			const currentValue = this.plugin.settings.model;
			dropdown.setValue(currentValue);
			
			dropdown.onChange(async (value) => {
				if (value === 'custom') {
					// Show text input for custom model
					const customModel = await this.showCustomModelDialog();
					if (customModel) {
						this.plugin.settings.model = customModel;
					}
				} else {
					this.plugin.settings.model = value;
				}
				await this.plugin.saveSettings();
				this.display(); // Refresh the display
			});
		});
	}
	
	async showCustomModelDialog(): Promise<string | null> {
		return new Promise((resolve) => {
			const modal = new CustomModelModal(this.app, (result) => {
				resolve(result);
			});
			modal.open();
		});
	}
	
	async createOpenAIModelDropdown(modelSetting: Setting, containerEl: HTMLElement) {
		const currentApiKey = this.plugin.getCurrentApiKey();
		
		// Check if API key exists
		if (!currentApiKey || currentApiKey.trim() === '') {
			modelSetting.setDesc('Please enter an API key first to load available models');
			modelSetting.addText(text => text
				.setPlaceholder('Enter model name manually')
				.setValue(this.plugin.settings.model)
				.onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				}));
			return;
		}
		
		// Fetch OpenAI models if not already loaded
		if (this.plugin.openaiModels.length === 0) {
			try {
				// Add loading state
				modelSetting.setDesc('Loading available models...');
				
				if (this.plugin.provider && 'getAvailableModels' in this.plugin.provider) {
					const provider = this.plugin.provider as any; // Type assertion for optional method
					this.plugin.openaiModels = await provider.getAvailableModels(currentApiKey);
				}
			} catch (error) {
				console.error('Failed to load OpenAI models:', error);
				modelSetting.setDesc('Failed to load models. Please check your API key and try again.');
				// Fall back to text input
				modelSetting.addText(text => text
					.setPlaceholder('Enter model name manually')
					.setValue(this.plugin.settings.model)
					.onChange(async (value) => {
						this.plugin.settings.model = value;
						await this.plugin.saveSettings();
					}));
				return;
			}
		}
		
		// Create dropdown with available models
		modelSetting.setDesc('Select AI model to use');
		modelSetting.addDropdown(dropdown => {
			// Add available models to dropdown
			this.plugin.openaiModels.forEach(model => {
				dropdown.addOption(model.id, model.name);
			});
			
			// Add custom option for manual model entry
			dropdown.addOption('custom', 'Custom (enter model ID manually)');
			
			// Set current value
			const currentValue = this.plugin.settings.model;
			dropdown.setValue(currentValue);
			
			dropdown.onChange(async (value) => {
				if (value === 'custom') {
					// Show text input for custom model
					const customModel = await this.showCustomModelDialog();
					if (customModel) {
						this.plugin.settings.model = customModel;
					}
				} else {
					this.plugin.settings.model = value;
				}
				await this.plugin.saveSettings();
				this.display(); // Refresh the display
			});
		});
	}
	
	async createGenericModelDropdown(modelSetting: Setting, containerEl: HTMLElement) {
		const currentApiKey = this.plugin.getCurrentApiKey();
		
		// Check if API key exists
		if (!currentApiKey || currentApiKey.trim() === '') {
			modelSetting.setDesc('Please enter an API key first to load available models');
			modelSetting.addText(text => text
				.setPlaceholder('Enter model ID manually')
				.setValue(this.plugin.settings.model)
				.onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				}));
			return;
		}
		
		// Generic implementation for providers with getAvailableModels
		let models: { id: string; name: string }[] = [];
		
		try {
			// Add loading state
			modelSetting.setDesc('Loading available models...');
			
			if (this.plugin.provider && 'getAvailableModels' in this.plugin.provider) {
				const provider = this.plugin.provider as any; // Type assertion for optional method
				models = await provider.getAvailableModels(currentApiKey);
			}
		} catch (error) {
			console.error('Failed to load models:', error);
			modelSetting.setDesc('Failed to load models. Please check your API key and try again.');
			// Fall back to text input
			modelSetting.addText(text => text
				.setPlaceholder('Enter model ID manually')
				.setValue(this.plugin.settings.model)
				.onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				}));
			return;
		}
		
		// Create dropdown with available models
		modelSetting.setDesc('Select AI model to use');
		modelSetting.addDropdown(dropdown => {
			// Add available models to dropdown
			models.forEach(model => {
				dropdown.addOption(model.id, model.name);
			});
			
			// Add custom option for manual model entry
			dropdown.addOption('custom', 'Custom (enter model ID manually)');
			
			// Set current value
			const currentValue = this.plugin.settings.model;
			dropdown.setValue(currentValue);
			
			dropdown.onChange(async (value) => {
				if (value === 'custom') {
					// Show text input for custom model
					const customModel = await this.showCustomModelDialog();
					if (customModel) {
						this.plugin.settings.model = customModel;
					}
				} else {
					this.plugin.settings.model = value;
				}
				await this.plugin.saveSettings();
				this.display(); // Refresh the display
			});
		});
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'AI Grammar Assistant Settings'});

		new Setting(containerEl)
			.setName('AI Provider')
			.setDesc('Select the AI service provider to use for grammar checking and suggestions')
			.addDropdown(dropdown => {
				const providers = ProviderFactory.getAvailableProviders();
				providers.forEach(provider => {
					dropdown.addOption(provider.name, provider.displayName);
				});
				
				dropdown.setValue(this.plugin.settings.provider)
					.onChange(async (value) => {
						this.plugin.settings.provider = value;
						
						// Clear cached models when switching providers
						this.plugin.straicoproviderModels = [];
						this.plugin.openaiModels = [];
						
						// Update default settings based on provider selection
						const newProvider = ProviderFactory.createProvider(value);
						if (newProvider) {
							this.plugin.settings.baseUrl = newProvider.getDefaultBaseUrl();
							this.plugin.settings.model = newProvider.getDefaultModel();
							this.plugin.settings.temperature = newProvider.getDefaultTemperature();
						}
						
						await this.plugin.saveSettings();
						this.display(); // Refresh the settings display to show the correct API key
					});
			});

		new Setting(containerEl)
			.setName('API Key')
			.setDesc(`Your ${this.plugin.provider?.displayName || 'AI'} service API key`)
			.addText(text => text
				.setPlaceholder('Enter your API key')
				.setValue(this.plugin.getCurrentApiKey())
				.onChange(async (value) => {
					const oldProvider = this.plugin.settings.provider;
					this.plugin.setCurrentApiKey(value);
					await this.plugin.saveSettings();
					
					// Clear cached models when API key changes
					if (oldProvider === 'straico') {
						this.plugin.straicoproviderModels = [];
					} else if (oldProvider === 'openai') {
						this.plugin.openaiModels = [];
					}
					
					// Refresh display to update model dropdown
					this.display();
				}));

		const modelSetting = new Setting(containerEl)
			.setName('Model')
			.setDesc('AI model to use');
		
		// Check if current provider supports model selection
		if (this.plugin.provider && 'getAvailableModels' in this.plugin.provider) {
			if (this.plugin.settings.provider === 'straico') {
				// Straico provider - show dropdown of available models
				this.createStraicoModelDropdown(modelSetting, containerEl);
			} else if (this.plugin.settings.provider === 'openai') {
				// OpenAI provider - show dropdown of available models
				this.createOpenAIModelDropdown(modelSetting, containerEl);
			} else {
				// Fallback for other providers with getAvailableModels
				this.createGenericModelDropdown(modelSetting, containerEl);
			}
		} else {
			// Other providers - show text input
			modelSetting.addText(text => text
				.setPlaceholder('Enter model name')
				.setValue(this.plugin.settings.model)
				.onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				}));
		}

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
		
		if (this.plugin.settings.provider === 'zai') {
			containerEl.createEl('p', {text: '1. Get an API key from Zhipu AI (https://z.ai/manage-apikey/apikey-list)'});
		} else if (this.plugin.settings.provider === 'openai') {
			containerEl.createEl('p', {text: '1. Get an API key from OpenAI (https://platform.openai.com/api-keys)'});
		} else if (this.plugin.settings.provider === 'straico') {
			containerEl.createEl('p', {text: '1. Get an API key from Straico (https://straico.com/)'});
		}
		
		containerEl.createEl('p', {text: '2. Select your provider above and enter your API key'});
		containerEl.createEl('p', {text: '3. Right-click on any note or selected text to use the AI assistant'});
	}
}

class CustomModelModal extends Modal {
	private onSubmit: (result: string) => void;
	private inputEl: HTMLInputElement;
	
	constructor(app: App, onSubmit: (result: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}
	
	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Enter Custom Model ID' });
		
		const inputContainer = contentEl.createDiv();
		inputContainer.createEl('p', { 
			text: 'Enter the Straico model ID (e.g., "openai/gpt-4o"):' 
		});
		
		this.inputEl = inputContainer.createEl('input', {
			type: 'text',
			placeholder: 'openai/gpt-4o',
			value: ''
		});
		this.inputEl.style.width = '100%';
		this.inputEl.style.marginTop = '10px';
		
		const buttonContainer = contentEl.createDiv();
		buttonContainer.style.marginTop = '20px';
		buttonContainer.style.textAlign = 'right';
		
		const submitButton = buttonContainer.createEl('button', {
			text: 'Submit',
			cls: 'mod-cta'
		});
		submitButton.style.marginRight = '10px';
		
		const cancelButton = buttonContainer.createEl('button', {
			text: 'Cancel'
		});
		
		submitButton.onclick = () => {
			const value = this.inputEl.value.trim();
			if (value) {
				this.onSubmit(value);
			}
			this.close();
		};
		
		cancelButton.onclick = () => {
			this.onSubmit('');
			this.close();
		};
		
		// Focus on input
		setTimeout(() => {
			this.inputEl.focus();
		}, 10);
	}
	
	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}