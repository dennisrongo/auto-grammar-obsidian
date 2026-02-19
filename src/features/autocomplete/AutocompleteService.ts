import { Editor, Notice } from 'obsidian';
import type { AIProvider } from '../../providers';
import type { AISettings, AutocompleteSuggestion } from '../../types';
import { shouldTriggerAutocomplete, escapeHtml, isAtSentenceStart, adjustSuggestionCasing } from '../../utils';

export class AutocompleteService {
	private timer: NodeJS.Timeout | null = null;
	private currentSuggestion: AutocompleteSuggestion | null = null;
	private hintElement: HTMLElement | null = null;
	private isAccepting: boolean = false;
	private lastCursorPosition: number = 0;
	
	constructor(
		private getProvider: () => AIProvider | null,
		private getSettings: () => AISettings,
		private getCurrentApiKey: () => string,
		private handleRateLimit: () => void,
		private isRateLimited: () => boolean,
		private updateStatusBar: (text: string) => void
	) {}
	
	scheduleAutocomplete(editor: Editor, noteTitle?: string): void {
		if (this.isAccepting) {
			console.log('Autocomplete skipped: currently accepting a suggestion');
			return;
		}
		
		if (this.timer) {
			clearTimeout(this.timer);
		}

		this.clearAutocomplete();

		this.updateStatusBar('⏳ Getting AI suggestion...');

		this.timer = setTimeout(async () => {
			await this.getSuggestion(editor, noteTitle);
			this.updateStatusBar('');
		}, this.getSettings().autocompleteDebounceMs);
	}
	
	cancelScheduled(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}
	
	updateCursorPosition(position: number): void {
		this.lastCursorPosition = position;
	}
	
	async triggerManually(editor: Editor, noteTitle?: string): Promise<void> {
		if (!this.getSettings().autocompleteEnabled) {
			new Notice('Autocomplete is disabled. Enable it in settings.');
			return;
		}
		
		new Notice('Getting suggestion...');
		this.updateStatusBar('⏳ Getting AI suggestion...');
		await this.getSuggestion(editor, noteTitle);
		this.updateStatusBar('');
	}
	
	private async getSuggestion(editor: Editor, noteTitle?: string): Promise<void> {
		if (this.isRateLimited() || !this.getCurrentApiKey()) {
			console.log('Autocomplete skipped: rate limited or no API key');
			return;
		}

		try {
			const cursor = editor.getCursor();
			const cursorOffset = editor.posToOffset(cursor);
			const fullText = editor.getValue();
			
			console.log('Autocomplete triggered at position:', cursorOffset);
			
			const contextStart = Math.max(0, cursorOffset - 300);
			const contextBefore = fullText.substring(contextStart, cursorOffset);
			
			console.log('Context before cursor:', contextBefore.slice(-50));
			
			if (!shouldTriggerAutocomplete(contextBefore, 10)) {
				console.log('Autocomplete skipped: cursor in middle of word or not enough context');
				return;
			}

			console.log('Calling AI for autocomplete...');
			
			const suggestion = await this.callAI(contextBefore, noteTitle);
			
			console.log('Received suggestion:', suggestion);
			
			if (suggestion && suggestion.trim()) {
				const isStartOfSentence = isAtSentenceStart(contextBefore);
				const adjustedSuggestion = adjustSuggestionCasing(suggestion, isStartOfSentence);
				console.log('Casing adjusted:', { isStartOfSentence, adjustedSuggestion });
				this.display(editor, adjustedSuggestion, cursorOffset);
			} else {
				console.log('No suggestion received');
			}
		} catch (error) {
			console.error('Autocomplete error:', error);
		}
	}
	
	private async callAI(contextBefore: string, noteTitle?: string): Promise<string> {
		const provider = this.getProvider();
		if (!provider) {
			throw new Error('No AI provider configured');
		}
		
		try {
			const suggestion = await provider.getAutocompleteSuggestion(
				contextBefore, 
				this.getSettings().temperature, 
				this.getSettings().autocompleteMaxTokens,
				noteTitle
			);
			return suggestion;
		} catch (error: any) {
			if (error.message.includes('429')) {
				this.handleRateLimit();
			}
			throw error;
		}
	}
	
	private display(editor: Editor, suggestion: string, cursorPos: number): void {
		this.clearAutocomplete();
		
		console.log('Displaying autocomplete:', suggestion);
		
		const cleanSuggestion = suggestion.replace(/^[\r\n]+/, '').trim();
		
		this.currentSuggestion = {
			text: cleanSuggestion,
			startPos: cursorPos
		};

		this.showHint(cleanSuggestion);
		
		this.updateStatusBar('💡 Suggestion ready - Press → to accept');
	}
	
	private showHint(suggestion: string): void {
		if (this.hintElement && this.hintElement.parentNode) {
			this.hintElement.parentNode.removeChild(this.hintElement);
		}

		this.hintElement = document.createElement('div');
		this.hintElement.className = 'ai-autocomplete-hint';
		
		const cleanSuggestion = suggestion.replace(/^[\r\n]+/, '').trim();
		const preview = cleanSuggestion.length > 80 ? cleanSuggestion.substring(0, 80) + '...' : cleanSuggestion;
		
		this.hintElement.innerHTML = `
			<div style="display: flex; flex-direction: column; gap: 8px; width: 100%;">
				<div style="display: flex; align-items: center; gap: 8px;">
					<span style="font-size: 18px;">💡</span>
					<span style="font-weight: 600; color: var(--text-normal); font-size: 14px;">AI Suggestion Available</span>
				</div>
				<div style="background: var(--background-secondary); padding: 10px 14px; border-radius: 6px; font-family: var(--font-text); font-size: 14px; line-height: 1.5; color: var(--text-muted); border-left: 3px solid #4a9eff;">
					<span style="color: rgba(128,128,128,0.9); font-style: italic;">${escapeHtml(preview)}</span>
				</div>
				<div style="display: flex; gap: 16px; align-items: center; font-size: 12px; color: var(--text-muted);">
					<span><kbd style="background: var(--background-modifier-border); padding: 3px 8px; border-radius: 4px; font-family: monospace; margin-right: 4px;">→</kbd> Accept</span>
					<span><kbd style="background: var(--background-modifier-border); padding: 3px 8px; border-radius: 4px; font-family: monospace; margin-right: 4px;">Esc</kbd> Dismiss</span>
				</div>
			</div>
		`;

		this.hintElement.style.cssText = `
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

		document.body.appendChild(this.hintElement);
		
		console.log('Autocomplete hint displayed');
	}
	
	handleKeyDown(evt: KeyboardEvent, editor: Editor | null): boolean {
		if (!this.currentSuggestion) return false;
		
		if (evt.key === 'ArrowRight' && !evt.ctrlKey && !evt.metaKey && !evt.altKey) {
			if (editor) {
				const cursor = editor.getCursor();
				const line = editor.getLine(cursor.line);
				if (cursor.ch >= line.length) {
					evt.preventDefault();
					evt.stopPropagation();
					this.accept(editor);
					return true;
				}
			}
		} else if (evt.key === 'Escape') {
			this.clearAutocomplete();
			return true;
		} else if (evt.key.length === 1 && !evt.ctrlKey && !evt.metaKey && !evt.altKey) {
			this.clearAutocomplete();
		}
		
		return false;
	}
	
	private accept(editor: Editor): void {
		if (!this.currentSuggestion) {
			return;
		}

		this.isAccepting = true;

		const cursor = editor.getCursor();
		
		let textToInsert = this.currentSuggestion.text;
		textToInsert = textToInsert.replace(/^[\r\n]+/, '');
		textToInsert = textToInsert.trimStart();
		
		console.log('Accepting autocomplete, original:', this.currentSuggestion.text);
		console.log('Cleaned text to insert:', textToInsert);
		
		editor.replaceRange(textToInsert, cursor);
		
		const newPos = {
			line: cursor.line,
			ch: cursor.ch + textToInsert.length
		};
		editor.setCursor(newPos);
		
		new Notice('✓ Suggestion accepted');
		this.clearAutocomplete();
		
		setTimeout(() => {
			this.isAccepting = false;
		}, 500);
	}
	
	hasSuggestion(): boolean {
		return this.currentSuggestion !== null;
	}
	
	clearAutocomplete(): void {
		if (this.hintElement && this.hintElement.parentNode) {
			this.hintElement.parentNode.removeChild(this.hintElement);
		}
		this.hintElement = null;
		this.currentSuggestion = null;
		
		this.updateStatusBar('');
	}
	
	destroy(): void {
		this.cancelScheduled();
		this.clearAutocomplete();
	}
}
