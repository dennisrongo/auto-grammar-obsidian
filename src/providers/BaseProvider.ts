import { AIProvider } from './types';
import { GrammarSuggestion, ModelInfo } from '../types';
import { parseJsonArray, removeDuplicatePrefix } from '../utils';

export abstract class BaseProvider implements AIProvider {
	abstract name: string;
	abstract displayName: string;
	
	protected apiKey: string = '';
	protected model: string = '';
	protected baseUrl: string = '';
	
	abstract getDefaultBaseUrl(): string;
	abstract getDefaultModel(): string;
	abstract getDefaultTemperature(): number;
	abstract getMaxTokens(): { default: number; max: number };
	
	setConfiguration(apiKey: string, model: string, baseUrl: string): void {
		this.apiKey = apiKey;
		this.model = model;
		this.baseUrl = baseUrl;
	}
	
	protected getApiKey(): string {
		return this.apiKey;
	}
	
	protected getModel(): string {
		return this.model || this.getDefaultModel();
	}
	
	protected getBaseUrl(): string {
		return this.baseUrl || this.getDefaultBaseUrl();
	}
	
	protected async makeChatRequest(
		systemPrompt: string,
		userMessage: string,
		temperature: number,
		maxTokens: number
	): Promise<string> {
		const response = await fetch(this.getBaseUrl(), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.getApiKey()}`
			},
			body: JSON.stringify({
				model: this.getModel(),
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userMessage }
				],
				temperature,
				max_tokens: maxTokens
			})
		});

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}, message: ${await response.text()}`);
		}

		const data = await response.json();
		let result = data.choices?.[0]?.message?.content || '';
		
		if (typeof result === 'string') {
			result = result.trim();
		}
		
		return result;
	}
	
	protected extractChoicesFromResponse(data: any): string {
		return data.choices?.[0]?.message?.content || '';
	}
	
	async callAPI(text: string, instruction: string, temperature: number, maxTokens: number = 2000): Promise<string> {
		return this.makeChatRequest(instruction, text, temperature, maxTokens);
	}
	
	async getGrammarSuggestions(text: string, temperature: number): Promise<GrammarSuggestion[]> {
		const systemPrompt = 'You are a grammar checker. Analyze the text for grammar, spelling, and style issues. For each issue found, provide a JSON response with the start position, end position, suggestion text, type (grammar/spelling/style), and original text. Return ONLY the JSON array WITHOUT markdown formatting or code blocks. Do NOT use ```json or ```. Just return the raw JSON array. Format: [{"start": 0, "end": 5, "suggestion": "corrected", "type": "grammar", "original": "wrong"}]';
		
		const content = await this.makeChatRequest(
			systemPrompt,
			`Please analyze this text for grammar and spelling issues: "${text}"`,
			temperature,
			1500
		);
		
		return parseJsonArray<GrammarSuggestion>(content);
	}
	
	async getAutocompleteSuggestion(contextBefore: string, temperature: number, maxTokens: number): Promise<string> {
		const systemPrompt = 'You are a professional writing assistant. Continue the text in a formal, professional tone. Use clear and concise language. Avoid casual phrases, slang, or overly conversational style. Write as if for a business document or professional publication. Return ONLY the continuation text, nothing else. Do not repeat any of the input text. Keep it concise (1-2 sentences maximum).';
		
		let suggestion = await this.makeChatRequest(
			systemPrompt,
			`Continue this text professionally: "${contextBefore}"`,
			temperature,
			maxTokens
		);
		
		suggestion = suggestion.trim();
		
		if (contextBefore.endsWith(' ') || contextBefore.endsWith('\n')) {
			suggestion = suggestion.trimStart();
		}
		
		return removeDuplicatePrefix(contextBefore, suggestion);
	}
	
	async testConnection(apiKey: string, model: string): Promise<boolean> {
		try {
			const savedApiKey = this.apiKey;
			const savedModel = this.model;
			
			this.apiKey = apiKey;
			this.model = model || this.getDefaultModel();
			
			const response = await fetch(this.getBaseUrl(), {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.getApiKey()}`
				},
				body: JSON.stringify({
					model: this.getModel(),
					messages: [
						{ role: 'system', content: 'You are a helpful AI assistant.' },
						{ role: 'user', content: 'Hello, please respond with "OK" to confirm you are working.' }
					],
					temperature: this.getDefaultTemperature(),
					max_tokens: 50
				})
			});

			this.apiKey = savedApiKey;
			this.model = savedModel;

			if (!response.ok) {
				return false;
			}

			const data = await response.json();
			return data.choices && data.choices.length > 0;
		} catch {
			return false;
		}
	}
	
	async getAvailableModels?(_apiKey: string): Promise<ModelInfo[]> {
		return [];
	}
}
