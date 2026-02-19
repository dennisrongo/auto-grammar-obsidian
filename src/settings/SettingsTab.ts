import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type { AIProvider } from '../providers';
import { ProviderFactory } from '../providers';
import type { AISettings, ModelInfo } from '../types';
import { CustomModelModal } from '../ui/modals/CustomModelModal';

export interface SettingsTabDependencies {
	getSettings: () => AISettings;
	saveSettings: () => Promise<void>;
	getProvider: () => AIProvider | null;
	getCurrentApiKey: () => string;
	setCurrentApiKey: (key: string) => void;
	testApiConnection: () => Promise<boolean>;
	
	straicoModels: ModelInfo[];
	openaiModels: ModelInfo[];
	clearModelCache: () => void;
}

export class AISettingsTab extends PluginSettingTab {
	private deps: SettingsTabDependencies;
	
	constructor(app: App, private containerElement: HTMLElement, deps: SettingsTabDependencies) {
		super(app, containerElement as any);
		this.deps = deps;
	}
	
	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'AI Grammar Assistant Settings' });

		this.createProviderSettings(containerEl);
		this.createModelSettings(containerEl);
		this.createAdvancedSettings(containerEl);
		this.createRealTimeSettings(containerEl);
		this.createAutocompleteSettings(containerEl);
		this.createGettingStartedSection(containerEl);
	}
	
	private createProviderSettings(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName('AI Provider')
			.setDesc('Select the AI service provider to use for grammar checking and suggestions')
			.addDropdown(dropdown => {
				const providers = ProviderFactory.getAvailableProviders();
				providers.forEach(provider => {
					dropdown.addOption(provider.name, provider.displayName);
				});
				
				dropdown.setValue(this.deps.getSettings().provider)
					.onChange(async (value) => {
						this.deps.getSettings().provider = value;
						this.deps.clearModelCache();
						
						const newProvider = ProviderFactory.createProvider(value);
						if (newProvider) {
							this.deps.getSettings().baseUrl = newProvider.getDefaultBaseUrl();
							this.deps.getSettings().model = newProvider.getDefaultModel();
							this.deps.getSettings().temperature = newProvider.getDefaultTemperature();
						}
						
						await this.deps.saveSettings();
						this.display();
					});
			});

		new Setting(containerEl)
			.setName('API Key')
			.setDesc(`Your ${this.deps.getProvider()?.displayName || 'AI'} service API key`)
			.addText(text => text
				.setPlaceholder('Enter your API key')
				.setValue(this.deps.getCurrentApiKey())
				.onChange(async (value) => {
					this.deps.setCurrentApiKey(value);
					await this.deps.saveSettings();
					this.display();
				}));
	}
	
	private createModelSettings(containerEl: HTMLElement): void {
		const modelSetting = new Setting(containerEl)
			.setName('Model')
			.setDesc('AI model to use');
		
		const provider = this.deps.getProvider();
		if (provider && 'getAvailableModels' in provider) {
			this.createModelDropdown(modelSetting, containerEl);
		} else {
			modelSetting.addText(text => text
				.setPlaceholder('Enter model name')
				.setValue(this.deps.getSettings().model)
				.onChange(async (value) => {
					this.deps.getSettings().model = value;
					await this.deps.saveSettings();
				}));
		}

		new Setting(containerEl)
			.setName('Base URL')
			.setDesc('API endpoint URL')
			.addText(text => text
				.setPlaceholder('https://api.z.ai/api/paas/v4/chat/completions')
				.setValue(this.deps.getSettings().baseUrl)
				.onChange(async (value) => {
					this.deps.getSettings().baseUrl = value;
					await this.deps.saveSettings();
				}));
	}
	
	private async createModelDropdown(modelSetting: Setting, containerEl: HTMLElement): Promise<void> {
		const currentApiKey = this.deps.getCurrentApiKey();
		
		if (!currentApiKey || currentApiKey.trim() === '') {
			modelSetting.setDesc('Please enter an API key first to load available models');
			modelSetting.addText(text => text
				.setPlaceholder('Enter model ID manually')
				.setValue(this.deps.getSettings().model)
				.onChange(async (value) => {
					this.deps.getSettings().model = value;
					await this.deps.saveSettings();
				}));
			return;
		}
		
		let models: ModelInfo[] = [];
		const provider = this.deps.getProvider();
		const settings = this.deps.getSettings();
		
		if (settings.provider === 'straico' && this.deps.straicoModels.length > 0) {
			models = this.deps.straicoModels;
		} else if (settings.provider === 'openai' && this.deps.openaiModels.length > 0) {
			models = this.deps.openaiModels;
		} else if (provider && 'getAvailableModels' in provider) {
			try {
				modelSetting.setDesc('Loading available models...');
				models = await (provider as any).getAvailableModels(currentApiKey);
				
				if (settings.provider === 'straico') {
					this.deps.straicoModels = models;
				} else if (settings.provider === 'openai') {
					this.deps.openaiModels = models;
				}
			} catch (error) {
				console.error('Failed to load models:', error);
				modelSetting.setDesc('Failed to load models. Please check your API key and try again.');
				modelSetting.addText(text => text
					.setPlaceholder('Enter model ID manually')
					.setValue(this.deps.getSettings().model)
					.onChange(async (value) => {
						this.deps.getSettings().model = value;
						await this.deps.saveSettings();
					}));
				return;
			}
		}
		
		modelSetting.setDesc('Select AI model to use');
		modelSetting.addDropdown(dropdown => {
			models.forEach(model => {
				dropdown.addOption(model.id, model.name);
			});
			
			dropdown.addOption('custom', 'Custom (enter model ID manually)');
			dropdown.setValue(this.deps.getSettings().model);
			
			dropdown.onChange(async (value) => {
				if (value === 'custom') {
					const customModel = await this.showCustomModelDialog();
					if (customModel) {
						this.deps.getSettings().model = customModel;
					}
				} else {
					this.deps.getSettings().model = value;
				}
				await this.deps.saveSettings();
				this.display();
			});
		});
	}
	
	private async showCustomModelDialog(): Promise<string | null> {
		return new Promise((resolve) => {
			const modal = new CustomModelModal(this.app, (result) => {
				resolve(result);
			});
			modal.open();
		});
	}
	
	private createAdvancedSettings(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName('Temperature')
			.setDesc('Controls randomness in AI responses (0.0 = deterministic, 1.0 = creative)')
			.addSlider(slider => slider
				.setLimits(0.0, 1.0, 0.1)
				.setValue(this.deps.getSettings().temperature)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.deps.getSettings().temperature = value;
					await this.deps.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Test API Connection')
			.setDesc('Test if your API settings are working correctly')
			.addButton(button => button
				.setButtonText('Test Connection')
				.onClick(async () => {
					button.setDisabled(true);
					button.setButtonText('Testing...');
					
					const success = await this.deps.testApiConnection();
					
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
	}
	
	private createRealTimeSettings(containerEl: HTMLElement): void {
		containerEl.createEl('h3', { text: 'Real-time Grammar Checking' });

		new Setting(containerEl)
			.setName('Enable Real-time Checking')
			.setDesc('Automatically check grammar as you type')
			.addToggle(toggle => toggle
				.setValue(this.deps.getSettings().realTimeEnabled)
				.onChange(async (value) => {
					this.deps.getSettings().realTimeEnabled = value;
					await this.deps.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Debounce Delay (ms)')
			.setDesc('Delay before checking grammar after typing stops')
			.addSlider(slider => slider
				.setLimits(500, 3000, 100)
				.setValue(this.deps.getSettings().debounceMs)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.deps.getSettings().debounceMs = value;
					await this.deps.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Rate Limit Backoff (minutes)')
			.setDesc('How long to pause when rate limit is reached')
			.addSlider(slider => slider
				.setLimits(1, 60, 1)
				.setValue(this.deps.getSettings().rateLimitBackoff / 60000)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.deps.getSettings().rateLimitBackoff = value * 60000;
					await this.deps.saveSettings();
				}));
	}
	
	private createAutocompleteSettings(containerEl: HTMLElement): void {
		containerEl.createEl('h3', { text: 'AI Autocomplete / IntelliSense' });

		new Setting(containerEl)
			.setName('Enable Autocomplete')
			.setDesc('Show AI-powered text predictions as you type')
			.addToggle(toggle => toggle
				.setValue(this.deps.getSettings().autocompleteEnabled)
				.onChange(async (value) => {
					this.deps.getSettings().autocompleteEnabled = value;
					await this.deps.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Autocomplete Delay (ms)')
			.setDesc('Delay before showing suggestions after you stop typing')
			.addSlider(slider => slider
				.setLimits(200, 2000, 100)
				.setValue(this.deps.getSettings().autocompleteDebounceMs)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.deps.getSettings().autocompleteDebounceMs = value;
					await this.deps.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Max Suggestion Length (tokens)')
			.setDesc('Maximum length of autocomplete suggestions')
			.addSlider(slider => slider
				.setLimits(10, 100, 5)
				.setValue(this.deps.getSettings().autocompleteMaxTokens)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.deps.getSettings().autocompleteMaxTokens = value;
					await this.deps.saveSettings();
				}));

		containerEl.createEl('p', { text: '💡 Press → (Right Arrow) to accept suggestions, Esc to dismiss' });
		containerEl.createEl('p', { text: 'Ghost text will appear in gray at your cursor position' });
	}
	
	private createGettingStartedSection(containerEl: HTMLElement): void {
		containerEl.createEl('h3', { text: 'How to get started:' });
		
		const provider = this.deps.getSettings().provider;
		if (provider === 'zai') {
			containerEl.createEl('p', { text: '1. Get an API key from Zhipu AI (https://z.ai/manage-apikey/apikey-list)' });
		} else if (provider === 'openai') {
			containerEl.createEl('p', { text: '1. Get an API key from OpenAI (https://platform.openai.com/api-keys)' });
		} else if (provider === 'straico') {
			containerEl.createEl('p', { text: '1. Get an API key from Straico (https://straico.com/)' });
		}
		
		containerEl.createEl('p', { text: '2. Select your provider above and enter your API key' });
		containerEl.createEl('p', { text: '3. Right-click on any note or selected text to use the AI assistant' });
	}
}
