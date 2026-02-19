import { App, Editor, MarkdownView, Notice, Plugin } from 'obsidian';
import type { AIProvider } from './providers';
import { ProviderFactory } from './providers';
import type { AISettings, ModelInfo } from './types';
import { GrammarService, RealTimeGrammarChecker, AutocompleteService } from './features';
import { AISettingsTab, DEFAULT_SETTINGS, migrateSettings } from './settings';

export default class AIGrammarAssistant extends Plugin {
	settings!: AISettings;
	provider: AIProvider | null = null;
	
	public straicoModels: ModelInfo[] = [];
	public openaiModels: ModelInfo[] = [];
	
	private grammarService!: GrammarService;
	private realTimeChecker!: RealTimeGrammarChecker;
	private autocompleteService!: AutocompleteService;
	
	private activeEditor: Editor | null = null;
	private rateLimitTimer: NodeJS.Timeout | null = null;
	private isRateLimited: boolean = false;
	private statusBarItem: HTMLElement | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.grammarService = new GrammarService(
			() => this.provider,
			() => this.settings,
			() => this.getCurrentApiKey(),
			() => this.handleRateLimit()
		);
		
		this.realTimeChecker = new RealTimeGrammarChecker(
			() => this.provider,
			() => this.settings,
			() => this.getCurrentApiKey(),
			() => this.handleRateLimit(),
			() => this.isRateLimited
		);
		
		this.autocompleteService = new AutocompleteService(
			() => this.provider,
			() => this.settings,
			() => this.getCurrentApiKey(),
			() => this.handleRateLimit(),
			() => this.isRateLimited,
			(text) => this.updateStatusBar(text)
		);

		this.setupRealTimeChecking();
		this.setupAutocomplete();
		this.setupContextMenu();
		this.setupCommands();
		
		this.addSettingTab(new AISettingsTab(
			this.app,
			{ containerEl: this.app.workspace.containerEl } as any,
			{
				getSettings: () => this.settings,
				saveSettings: () => this.saveSettings(),
				getProvider: () => this.provider,
				getCurrentApiKey: () => this.getCurrentApiKey(),
				setCurrentApiKey: (key) => this.setCurrentApiKey(key),
				testApiConnection: () => this.testApiConnection(),
				straicoModels: this.straicoModels,
				openaiModels: this.openaiModels,
				clearModelCache: () => this.clearModelCache()
			}
		));

		this.statusBarItem = this.addStatusBarItem();
		this.statusBarItem.setText('');
	}

	onunload(): void {
		this.realTimeChecker?.destroy();
		this.autocompleteService?.destroy();
		
		if (this.rateLimitTimer) {
			clearTimeout(this.rateLimitTimer);
		}
	}

	async loadSettings(): Promise<void> {
		const loadedData = await this.loadData();
		this.settings = migrateSettings(loadedData);
		this.initializeProvider();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.initializeProvider();
	}
	
	private initializeProvider(): void {
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
	
	setCurrentApiKey(apiKey: string): void {
		this.settings.apiKeys[this.settings.provider as keyof typeof this.settings.apiKeys] = apiKey;
	}
	
	clearModelCache(): void {
		this.straicoModels = [];
		this.openaiModels = [];
	}

	private setupRealTimeChecking(): void {
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf?.view instanceof MarkdownView) {
					this.activeEditor = leaf.view.editor;
					this.realTimeChecker.clearSuggestionMarkers();
				} else {
					this.activeEditor = null;
					this.realTimeChecker.clearSuggestionMarkers();
				}
			})
		);

		this.registerEvent(
			this.app.workspace.on('editor-change', (editor, view) => {
				if (this.settings.realTimeEnabled && this.activeEditor === editor) {
					this.realTimeChecker.scheduleCheck(editor, () => {});
				}
			})
		);
	}

	private setupAutocomplete(): void {
		this.registerEvent(
			this.app.workspace.on('editor-change', (editor, view) => {
				if (this.settings.autocompleteEnabled && this.activeEditor === editor) {
					this.autocompleteService.scheduleAutocomplete(editor);
				}
			})
		);

		this.registerEvent(
			this.app.workspace.on('editor-change', (editor, view) => {
				if (this.activeEditor === editor) {
					const cursor = editor.getCursor();
					const newPos = editor.posToOffset(cursor);
					this.autocompleteService.updateCursorPosition(newPos);
				}
			})
		);

		this.registerDomEvent(document, 'keydown', (evt) => {
			this.autocompleteService.handleKeyDown(evt, this.activeEditor);
		});
	}

	private setupContextMenu(): void {
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor, view) => {
				menu.addItem((item) => {
					item.setTitle('Correct Grammar (Selected)')
						.setIcon('spell-check')
						.onClick(async () => {
							await this.grammarService.correctSelectedText(editor);
						});
				});

				menu.addItem((item) => {
					item.setTitle('Correct Grammar (Document)')
						.setIcon('file-text')
						.onClick(async () => {
							await this.grammarService.correctEntireDocument(editor);
						});
				});

				menu.addItem((item) => {
					item.setTitle('Improve Writing (Selected)')
						.setIcon('pencil')
						.onClick(async () => {
							await this.grammarService.improveWriting(editor);
						});
				});
			})
		);
	}

	private setupCommands(): void {
		this.addCommand({
			id: 'correct-selected-grammar',
			name: 'Correct Grammar (Selected Text)',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.grammarService.correctSelectedText(editor);
			}
		});

		this.addCommand({
			id: 'correct-document-grammar',
			name: 'Correct Grammar (Entire Document)',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.grammarService.correctEntireDocument(editor);
			}
		});

		this.addCommand({
			id: 'improve-writing',
			name: 'Improve Writing (Selected Text)',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.grammarService.improveWriting(editor);
			}
		});

		this.addCommand({
			id: 'trigger-autocomplete',
			name: 'Trigger AI Autocomplete',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.autocompleteService.triggerManually(editor);
			}
		});

		this.addCommand({
			id: 'accept-autocomplete',
			name: 'Accept Autocomplete Suggestion',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				if (this.autocompleteService.hasSuggestion()) {
					this.autocompleteService.handleKeyDown({ 
						key: 'ArrowRight', 
						preventDefault: () => {}, 
						stopPropagation: () => {},
						ctrlKey: false,
						metaKey: false,
						altKey: false
					} as any, editor);
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
				
				await this.autocompleteService.triggerManually(editor);
			}
		});
	}

	private handleRateLimit(): void {
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

	private updateStatusBar(text: string): void {
		if (this.statusBarItem) {
			this.statusBarItem.setText(text);
		}
	}
}
