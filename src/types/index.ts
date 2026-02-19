export interface GrammarSuggestion {
	start: number;
	end: number;
	suggestion: string;
	type: 'grammar' | 'spelling' | 'style';
	original: string;
}

export interface AutocompleteSuggestion {
	text: string;
	startPos: number;
}

export interface AISettings {
	provider: string;
	apiKeys: {
		zai: string;
		openai: string;
		straico: string;
	};
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

export interface ModelInfo {
	id: string;
	name: string;
}

export interface ProviderInfo {
	name: string;
	displayName: string;
}
