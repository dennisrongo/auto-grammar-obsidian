import { Editor, MarkdownView, Notice } from 'obsidian';
import type { AIProvider } from '../../providers';
import type { AISettings, GrammarSuggestion } from '../../types';

export class RealTimeGrammarChecker {
	private debounceTimer: NodeJS.Timeout | null = null;
	private currentSuggestions: GrammarSuggestion[] = [];
	private suggestionMarkers: HTMLElement[] = [];
	
	constructor(
		private getProvider: () => AIProvider | null,
		private getSettings: () => AISettings,
		private getCurrentApiKey: () => string,
		private handleRateLimit: () => void,
		private isRateLimited: () => boolean
	) {}
	
	scheduleCheck(editor: Editor, noteTitle: string | undefined, callback: () => void): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}

		this.debounceTimer = setTimeout(async () => {
			await this.checkGrammar(editor, noteTitle);
			callback();
		}, this.getSettings().debounceMs);
	}
	
	cancelPendingCheck(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	}
	
	private async checkGrammar(editor: Editor, noteTitle?: string): Promise<void> {
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

		if (this.isRateLimited()) {
			console.log('Rate limited, skipping grammar check');
			return;
		}

		try {
			console.log('Starting real-time grammar check...');
			const suggestions = await this.getGrammarSuggestions(text, noteTitle);
			console.log('Suggestions received:', suggestions);
			this.displaySuggestions(editor, suggestions);
		} catch (error) {
			console.error('Real-time grammar check failed:', error);
			this.clearSuggestionMarkers();
			
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
	
	private async getGrammarSuggestions(text: string, noteTitle?: string): Promise<GrammarSuggestion[]> {
		if (this.isRateLimited()) {
			throw new Error('Rate limit in effect');
		}

		const provider = this.getProvider();
		if (!provider) {
			throw new Error('No AI provider configured');
		}

		console.log('Getting grammar suggestions for text length:', text.length);
		
		try {
			const suggestions = await provider.getGrammarSuggestions(text, this.getSettings().temperature, noteTitle);
			return suggestions;
		} catch (error: any) {
			if (error.message.includes('429') || error.message.includes('rate limit')) {
				throw new Error('Rate limit reached for requests');
			}
			throw error;
		}
	}
	
	private displaySuggestions(editor: Editor, suggestions: GrammarSuggestion[]): void {
		this.clearSuggestionMarkers();
		this.currentSuggestions = suggestions;

		suggestions.forEach(suggestion => {
			this.createSuggestionMarker(editor, suggestion);
		});
	}
	
	private createSuggestionMarker(editor: Editor, suggestion: GrammarSuggestion): void {
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

		this.positionMarker(marker);
		this.suggestionMarkers.push(marker);
	}
	
	private positionMarker(marker: HTMLElement): void {
		try {
			const activeView = (window as any).app?.workspace?.getActiveViewOfType?.(MarkdownView);
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
	
	private showSuggestionPopup(editor: Editor, suggestion: GrammarSuggestion, target: HTMLElement): void {
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

		const rect = target.getBoundingClientRect();
		popup.style.position = 'fixed';
		popup.style.left = `${rect.left}px`;
		popup.style.top = `${rect.bottom + 5}px`;
		popup.style.zIndex = '10000';

		document.body.appendChild(popup);

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

		const closeHandler = (e: MouseEvent) => {
			if (!popup.contains(e.target as Node)) {
				document.body.removeChild(popup);
				document.removeEventListener('click', closeHandler);
			}
		};
		setTimeout(() => document.addEventListener('click', closeHandler), 100);
	}
	
	private applySuggestion(editor: Editor, suggestion: GrammarSuggestion): void {
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
	
	clearSuggestionMarkers(): void {
		this.suggestionMarkers.forEach(marker => {
			if (marker.parentNode) {
				marker.parentNode.removeChild(marker);
			}
		});
		this.suggestionMarkers = [];
		this.currentSuggestions = [];
	}
	
	destroy(): void {
		this.cancelPendingCheck();
		this.clearSuggestionMarkers();
	}
}
