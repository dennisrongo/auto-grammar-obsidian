import { GrammarSuggestion, ModelInfo } from '../types';

export interface AIProvider {
	name: string;
	displayName: string;
	
	setConfiguration(apiKey: string, model: string, baseUrl: string): void;
	
	callAPI(text: string, instruction: string, temperature: number, maxTokens?: number): Promise<string>;
	getGrammarSuggestions(text: string, temperature: number, noteTitle?: string): Promise<GrammarSuggestion[]>;
	getAutocompleteSuggestion(contextBefore: string, temperature: number, maxTokens: number, noteTitle?: string): Promise<string>;
	
	testConnection(apiKey: string, model: string): Promise<boolean>;
	
	getDefaultBaseUrl(): string;
	getDefaultModel(): string;
	getDefaultTemperature(): number;
	getMaxTokens(): { default: number; max: number };
	
	getAvailableModels?(apiKey: string): Promise<ModelInfo[]>;
}
