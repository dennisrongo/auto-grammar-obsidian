import type { AISettings } from '../types';

export const DEFAULT_SETTINGS: AISettings = {
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
};

export function migrateSettings(loadedData: any): AISettings {
	if (loadedData && loadedData.apiKey && !loadedData.apiKeys) {
		loadedData.apiKeys = {
			zai: loadedData.apiKey,
			openai: '',
			straico: ''
		};
		delete loadedData.apiKey;
	}
	
	return Object.assign({}, DEFAULT_SETTINGS, loadedData);
}
