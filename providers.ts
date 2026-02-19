import { GrammarSuggestion, AutocompleteSuggestion } from './types';

function removeDuplicatePrefix(context: string, suggestion: string): string {
	// Get the last few words from context
	const contextWords = context.trim().toLowerCase().split(/\s+/);
	const suggestionWords = suggestion.trim().split(/\s+/);
	
	// Check for overlapping words at the start of suggestion
	for (let overlapCount = Math.min(contextWords.length, suggestionWords.length); overlapCount > 0; overlapCount--) {
		const contextEnd = contextWords.slice(-overlapCount);
		const suggestionStart = suggestionWords.slice(0, overlapCount).map(w => w.toLowerCase());
		
		// Check if the words match
		if (JSON.stringify(contextEnd) === JSON.stringify(suggestionStart)) {
			// Remove the overlapping words from suggestion
			return suggestionWords.slice(overlapCount).join(' ');
		}
	}
	
	// Also check for partial word overlap (e.g., "test" at end of context, "testing" at start of suggestion)
	if (contextWords.length > 0 && suggestionWords.length > 0) {
		const lastContextWord = contextWords[contextWords.length - 1];
		const firstSuggestionWord = suggestionWords[0].toLowerCase();
		
		if (firstSuggestionWord.startsWith(lastContextWord) && firstSuggestionWord !== lastContextWord) {
			// The first word of suggestion starts with the last word of context
			// Remove the overlapping part
			const remaining = firstSuggestionWord.substring(lastContextWord.length);
			if (remaining.length > 0) {
				return remaining + suggestionWords.slice(1).join(' ');
			}
		}
	}
	
	return suggestion;
}

export interface AIProvider {
	name: string;
	displayName: string;
	
	// Configuration
	setConfiguration(apiKey: string, model: string, baseUrl: string): void;
	
	// Core AI functionality
	callAPI(text: string, instruction: string, temperature: number, maxTokens?: number): Promise<string>;
	getGrammarSuggestions(text: string, temperature: number): Promise<GrammarSuggestion[]>;
	getAutocompleteSuggestion(contextBefore: string, temperature: number, maxTokens: number): Promise<string>;
	
	// Connection testing
	testConnection(apiKey: string, model: string): Promise<boolean>;
	
	// Default configuration
	getDefaultBaseUrl(): string;
	getDefaultModel(): string;
	getDefaultTemperature(): number;
	getMaxTokens(): { default: number; max: number };
	
	// Model information (optional, for providers that support multiple models)
	getAvailableModels?(apiKey: string): Promise<{ id: string; name: string }[]>;
}

export class ZAIProvider implements AIProvider {
	name = 'zai';
	displayName = 'Z.ai';
	private apiKey: string = '';
	private model: string = '';
	private baseUrl: string = '';
	
	setConfiguration(apiKey: string, model: string, baseUrl: string) {
		this.apiKey = apiKey;
		this.model = model;
		this.baseUrl = baseUrl;
	}
	
	getDefaultBaseUrl(): string {
		return 'https://api.z.ai/api/paas/v4/chat/completions';
	}
	
	getDefaultModel(): string {
		return 'GLM-4-32B-0414-128K';
	}
	
	getDefaultTemperature(): number {
		return 0.1;
	}
	
	getMaxTokens(): { default: number; max: number } {
		return { default: 1500, max: 4000 };
	}
	
	async callAPI(text: string, instruction: string, temperature: number, maxTokens: number = 2000): Promise<string> {
		const response = await fetch(this.getBaseUrl(), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.getApiKey()}`
			},
			body: JSON.stringify({
				model: this.getModel(),
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
				temperature,
				max_tokens: maxTokens
			})
		});

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}, message: ${await response.text()}`);
		}

		const data = await response.json();
		let result = data.choices?.[0]?.message?.content || text;
		
		if (typeof result === 'string') {
			result = result.trim();
		}
		
		return result;
	}
	
	async getGrammarSuggestions(text: string, temperature: number): Promise<GrammarSuggestion[]> {
		const response = await fetch(this.getBaseUrl(), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.getApiKey()}`
			},
			body: JSON.stringify({
				model: this.getModel(),
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
				temperature,
				max_tokens: 1500
			})
		});

		if (!response.ok) {
			throw new Error(`API error: ${response.status}, ${await response.text()}`);
		}

		const data = await response.json();
		let content = data.choices?.[0]?.message?.content || '[]';
		
		// Handle different response formats
		if (typeof content === 'string') {
			content = content.trim();
			
			// Strip markdown code blocks if present (```json ... ``` or ``` ... ```)
			content = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
			content = content.trim();
			
			if (!content.startsWith('[') && !content.startsWith('{')) {
				const jsonMatch = content.match(/\[[\s\S]*\]/);
				if (jsonMatch) {
					content = jsonMatch[0];
				}
			}
		}
		
		try {
			const suggestions = JSON.parse(content);
			return Array.isArray(suggestions) ? suggestions : [];
		} catch (error) {
			console.error('Failed to parse suggestions JSON:', error, 'Content was:', content);
			return [];
		}
	}
	
	async getAutocompleteSuggestion(contextBefore: string, temperature: number, maxTokens: number): Promise<string> {
		const response = await fetch(this.getBaseUrl(), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.getApiKey()}`
			},
			body: JSON.stringify({
				model: this.getModel(),
				messages: [
					{
						role: 'system',
						content: 'You are a professional writing assistant. Continue the text in a formal, professional tone. Use clear and concise language. Avoid casual phrases, slang, or overly conversational style. Write as if for a business document or professional publication. Return ONLY the continuation text, nothing else. Do not repeat any of the input text. Keep it concise (1-2 sentences maximum).'
					},
					{
						role: 'user',
						content: `Continue this text professionally: "${contextBefore}"`
					}
				],
				temperature,
				max_tokens: maxTokens,
				stop: ['\n\n', '---']
			})
		});

		if (!response.ok) {
			throw new Error(`API error: ${response.status}`);
		}

		const data = await response.json();
		let suggestion = data.choices?.[0]?.message?.content || '';
		
		suggestion = suggestion.trim();
		
		// Remove any leading spaces if context ends with space
		if (contextBefore.endsWith(' ') || contextBefore.endsWith('\n')) {
			suggestion = suggestion.trimStart();
		}
		
		// Remove duplicated words from the start of suggestion that already exist at the end of context
		suggestion = removeDuplicatePrefix(contextBefore, suggestion);
		
		return suggestion;
	}
	
	async testConnection(apiKey: string, model: string): Promise<boolean> {
		try {
			const response = await fetch(this.getBaseUrl(), {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiKey}`
				},
				body: JSON.stringify({
					model: model || this.getDefaultModel(),
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
					temperature: this.getDefaultTemperature(),
					max_tokens: 50
				})
			});

			if (!response.ok) {
				return false;
			}

			const data = await response.json();
			return data.choices && data.choices.length > 0;
		} catch (error) {
			return false;
		}
	}
	
	private getApiKey(): string {
		return this.apiKey;
	}
	
	private getModel(): string {
		return this.model || this.getDefaultModel();
	}
	
	private getBaseUrl(): string {
		return this.baseUrl || this.getDefaultBaseUrl();
	}
}

export class OpenAIProvider implements AIProvider {
	name = 'openai';
	displayName = 'OpenAI';
	private apiKey: string = '';
	private model: string = '';
	private baseUrl: string = '';
	
	setConfiguration(apiKey: string, model: string, baseUrl: string) {
		this.apiKey = apiKey;
		this.model = model;
		this.baseUrl = baseUrl;
	}
	
	async getAvailableModels(apiKey: string): Promise<{ id: string; name: string }[]> {
		try {
			const response = await fetch('https://api.openai.com/v1/models', {
				method: 'GET',
				headers: {
					'Authorization': `Bearer ${apiKey}`
				}
			});

			if (!response.ok) {
				console.error('Failed to fetch OpenAI models:', response.status);
				// Return fallback models if API call fails
				return [
					{ id: 'gpt-4o', name: 'GPT-4o' },
					{ id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
					{ id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
					{ id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' }
				];
			}

			const data = await response.json();
			const models = data.data || [];
			
			// Filter and sort models
			const filteredModels = models
				.filter((model: any) => {
					// Only include chat models (not fine-tuned or specialized models)
					return model.id.includes('gpt') && 
						   !model.id.includes('fine-tune') && 
						   !model.id.includes(':');
				})
				.map((model: any) => {
					// Create a user-friendly name
					let name = model.id.replace('gpt-', 'GPT-').replace(/-/g, ' ');
					
					// Add some common model identifiers
					if (model.id.includes('4o')) {
						name = name + ' (Omni)';
					}
					if (model.id.includes('turbo')) {
						name = name + ' (Turbo)';
					}
					
					return {
						id: model.id,
						name: name
					};
				})
				.sort((a: any, b: any) => {
					// Sort by capability (newer models first)
					const order = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'];
					const aIndex = order.findIndex(id => a.id.includes(id));
					const bIndex = order.findIndex(id => b.id.includes(id));
					
					if (aIndex !== -1 && bIndex !== -1) {
						return aIndex - bIndex;
					} else if (aIndex !== -1) {
						return -1;
					} else if (bIndex !== -1) {
						return 1;
					}
					
					return a.id.localeCompare(b.id);
				});

			return filteredModels;
		} catch (error) {
			console.error('Failed to fetch OpenAI models:', error);
			// Return fallback models on error
			return [
				{ id: 'gpt-4o', name: 'GPT-4o' },
				{ id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
				{ id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
				{ id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' }
			];
		}
	}
	
	getDefaultBaseUrl(): string {
		return 'https://api.openai.com/v1/chat/completions';
	}
	
	getDefaultModel(): string {
		return 'gpt-4';
	}
	
	getDefaultTemperature(): number {
		return 0.1;
	}
	
	getMaxTokens(): { default: number; max: number } {
		return { default: 1500, max: 4000 };
	}
	
	async callAPI(text: string, instruction: string, temperature: number, maxTokens: number = 2000): Promise<string> {
		const response = await fetch(this.getBaseUrl(), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.getApiKey()}`
			},
			body: JSON.stringify({
				model: this.getModel(),
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
				temperature,
				max_tokens: maxTokens
			})
		});

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}, message: ${await response.text()}`);
		}

		const data = await response.json();
		let result = data.choices?.[0]?.message?.content || text;
		
		if (typeof result === 'string') {
			result = result.trim();
		}
		
		return result;
	}
	
	async getGrammarSuggestions(text: string, temperature: number): Promise<GrammarSuggestion[]> {
		const response = await fetch(this.getBaseUrl(), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.getApiKey()}`
			},
			body: JSON.stringify({
				model: this.getModel(),
				messages: [
					{
						role: 'system',
						content: 'You are a grammar checker. Analyze the text for grammar, spelling, and style issues. For each issue found, provide a JSON response with the start position, end position, suggestion text, type (grammar/spelling/style), and original text. Return ONLY the JSON array WITHOUT markdown formatting or code blocks. Do NOT use ```json or ```. Just return the raw JSON array. Format: [{"start": 0, "end": 5, "suggestion": "corrected", "type": "grammar", "original": "wrong"}]'
					},
					{
						role: 'user',
						content: `Please analyze this text for grammar and spelling issues: "${text}"`
					}
				],
				temperature,
				max_tokens: 1500
			})
		});

		if (!response.ok) {
			throw new Error(`API error: ${response.status}, ${await response.text()}`);
		}

		const data = await response.json();
		let content = data.choices?.[0]?.message?.content || '[]';
		
		// Handle different response formats
		if (typeof content === 'string') {
			content = content.trim();
			
			// Strip markdown code blocks if present (```json ... ``` or ``` ... ```)
			content = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
			content = content.trim();
			
			if (!content.startsWith('[') && !content.startsWith('{')) {
				const jsonMatch = content.match(/\[[\s\S]*\]/);
				if (jsonMatch) {
					content = jsonMatch[0];
				}
			}
		}
		
		try {
			const suggestions = JSON.parse(content);
			return Array.isArray(suggestions) ? suggestions : [];
		} catch (error) {
			console.error('Failed to parse suggestions JSON:', error, 'Content was:', content);
			return [];
		}
	}
	
	async getAutocompleteSuggestion(contextBefore: string, temperature: number, maxTokens: number): Promise<string> {
		const response = await fetch(this.getBaseUrl(), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.getApiKey()}`
			},
			body: JSON.stringify({
				model: this.getModel(),
				messages: [
					{
						role: 'system',
						content: 'You are a professional writing assistant. Continue the text in a formal, professional tone. Use clear and concise language. Avoid casual phrases, slang, or overly conversational style. Write as if for a business document or professional publication. Return ONLY the continuation text, nothing else. Do not repeat any of the input text. Keep it concise (1-2 sentences maximum).'
					},
					{
						role: 'user',
						content: `Continue this text professionally: "${contextBefore}"`
					}
				],
				temperature,
				max_tokens: maxTokens,
				stop: ['\n\n', '---']
			})
		});

		if (!response.ok) {
			throw new Error(`API error: ${response.status}`);
		}

		const data = await response.json();
		let suggestion = data.choices?.[0]?.message?.content || '';
		
		suggestion = suggestion.trim();
		
		// Remove any leading spaces if context ends with space
		if (contextBefore.endsWith(' ') || contextBefore.endsWith('\n')) {
			suggestion = suggestion.trimStart();
		}
		
		// Remove duplicated words from the start of suggestion that already exist at the end of context
		suggestion = removeDuplicatePrefix(contextBefore, suggestion);
		
		return suggestion;
	}
	
	async testConnection(apiKey: string, model: string): Promise<boolean> {
		try {
			const response = await fetch(this.getBaseUrl(), {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiKey}`
				},
				body: JSON.stringify({
					model: model || this.getDefaultModel(),
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
					temperature: this.getDefaultTemperature(),
					max_tokens: 50
				})
			});

			if (!response.ok) {
				return false;
			}

			const data = await response.json();
			return data.choices && data.choices.length > 0;
		} catch (error) {
			return false;
		}
	}
	
	private getApiKey(): string {
		return this.apiKey;
	}
	
	private getModel(): string {
		return this.model || this.getDefaultModel();
	}
	
	private getBaseUrl(): string {
		return this.baseUrl || this.getDefaultBaseUrl();
	}
}

export class StraicoProvider implements AIProvider {
	name = 'straico';
	displayName = 'Straico';
	private apiKey: string = '';
	private model: string = '';
	private baseUrl: string = '';
	
	setConfiguration(apiKey: string, model: string, baseUrl: string) {
		this.apiKey = apiKey;
		this.model = model;
		this.baseUrl = baseUrl;
	}
	
	async getAvailableModels(apiKey: string): Promise<{ id: string; name: string }[]> {
		try {
			// Fetch models from Straico API
			const response = await fetch('https://api.straico.com/v2/models', {
				method: 'GET',
				headers: {
					'Authorization': `Bearer ${apiKey}`
				}
			});

			if (!response.ok) {
				console.error('Failed to fetch Straico models:', response.status);
				// Return fallback models if API call fails
				return [
					{ id: 'openai/gpt-4o-mini', name: 'OpenAI: GPT-4o Mini' },
					{ id: 'openai/gpt-4o', name: 'OpenAI: GPT-4o' },
					{ id: 'anthropic/claude-3-haiku', name: 'Anthropic: Claude 3 Haiku' }
				];
			}

			const data = await response.json();
			const models = data.data || [];
			
			// Filter and sort models
			const filteredModels = models
				.filter((model: any) => {
					// Only include chat models (not image, video, audio models)
					return model.model_type === 'chat' && model.id;
				})
				.map((model: any) => {
					// Use the name field if available, otherwise use the id
					const name = model.name || model.id;
					
					return {
						id: model.id,
						name: name
					};
				})
				.sort((a: any, b: any) => {
					// Sort by name alphabetically
					return a.name.localeCompare(b.name);
				});

			return filteredModels;
		} catch (error) {
			console.error('Failed to fetch Straico models:', error);
			// Return fallback models on error
			return [
				{ id: 'openai/gpt-4o-mini', name: 'OpenAI: GPT-4o Mini' },
				{ id: 'openai/gpt-4o', name: 'OpenAI: GPT-4o' },
				{ id: 'anthropic/claude-3-haiku', name: 'Anthropic: Claude 3 Haiku' }
			];
		}
	}
	
getDefaultBaseUrl(): string {
		return 'https://api.straico.com/v1/prompt/completion';
	}
	
	getDefaultModel(): string {
		return 'openai/gpt-4o-mini';
	}
	
	getDefaultTemperature(): number {
		return 0.1;
	}
	
	getMaxTokens(): { default: number; max: number } {
		return { default: 1500, max: 4000 };
	}
	
	private extractContentFromResponse(data: any): string {
		// Handle Straico v1 response format
		// Response structure: { data: { completions: { "model-name": { completion: { choices: [...] } } } } }
		if (data.data?.completions) {
			const completions = data.data.completions;
			// Get the first model's completion
			const modelKeys = Object.keys(completions);
			if (modelKeys.length > 0) {
				const firstModelCompletion = completions[modelKeys[0]];
				const content = firstModelCompletion?.completion?.choices?.[0]?.message?.content;
				return content || '';
			}
		}
		// Fallback for other formats
		return data.choices?.[0]?.message?.content || '';
	}
	
	async callAPI(text: string, instruction: string, temperature: number, maxTokens: number = 2000): Promise<string> {
		const model = this.getModel();
		
		if (!model) {
			throw new Error('No model selected. Please select a model in the settings.');
		}
		
		if (!this.getApiKey()) {
			throw new Error('No API key configured. Please enter your Straico API key in the settings.');
		}
		
		const requestBody = {
			models: [model],
			message: `${instruction}\n\n${text}`,
			temperature,
			max_tokens: maxTokens
		};
		
		console.log('Straico API Request:', JSON.stringify(requestBody, null, 2));
		
		const response = await fetch(this.getBaseUrl(), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.getApiKey()}`
			},
			body: JSON.stringify(requestBody)
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error('Straico API Error:', response.status, errorText);
			throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
		}

		const data = await response.json();
		console.log('Straico API Response:', data);
		let result = this.extractContentFromResponse(data);
		
		if (typeof result === 'string') {
			result = result.trim();
		}
		
		return result || text;
	}
	
	async getGrammarSuggestions(text: string, temperature: number): Promise<GrammarSuggestion[]> {
		const model = this.getModel();
		
		if (!model) {
			throw new Error('No model selected. Please select a model in the settings.');
		}
		
		if (!this.getApiKey()) {
			throw new Error('No API key configured. Please enter your Straico API key in the settings.');
		}
		
		const requestBody = {
			models: [model],
			message: `You are a grammar checker. Analyze the text for grammar, spelling, and style issues. For each issue found, provide a JSON response with the start position, end position, suggestion text, type (grammar/spelling/style), and original text. Return ONLY the JSON array WITHOUT markdown formatting or code blocks. Do NOT use \`\`\`json or \`\`\`. Just return the raw JSON array. Format: [{"start": 0, "end": 5, "suggestion": "corrected", "type": "grammar", "original": "wrong"}]\n\nPlease analyze this text for grammar and spelling issues: "${text}"`,
			temperature,
			max_tokens: 1500
		};
		
		console.log('Straico Grammar Request:', JSON.stringify(requestBody, null, 2));
		
		const response = await fetch(this.getBaseUrl(), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.getApiKey()}`
			},
			body: JSON.stringify(requestBody)
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error('Straico Grammar API Error:', response.status, errorText);
			throw new Error(`API error: ${response.status}, ${errorText}`);
		}

		const data = await response.json();
		console.log('Straico Grammar Response:', data);
		let content = this.extractContentFromResponse(data);
		
		// Handle different response formats
		if (typeof content === 'string') {
			content = content.trim();
			
			// Strip markdown code blocks if present (```json ... ``` or ``` ... ```)
			content = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
			content = content.trim();
			
			if (!content.startsWith('[') && !content.startsWith('{')) {
				const jsonMatch = content.match(/\[[\s\S]*\]/);
				if (jsonMatch) {
					content = jsonMatch[0];
				}
			}
		}
		
		try {
			const suggestions = JSON.parse(content);
			return Array.isArray(suggestions) ? suggestions : [];
		} catch (error) {
			console.error('Failed to parse suggestions JSON:', error, 'Content was:', content);
			return [];
		}
	}
	
	async getAutocompleteSuggestion(contextBefore: string, temperature: number, maxTokens: number): Promise<string> {
		const response = await fetch(this.getBaseUrl(), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.getApiKey()}`
			},
			body: JSON.stringify({
				models: [this.getModel()],
				message: `You are a professional writing assistant. Continue the text in a formal, professional tone. Use clear and concise language. Avoid casual phrases, slang, or overly conversational style. Write as if for a business document or professional publication. Return ONLY the continuation text, nothing else. Do not repeat any of the input text. Keep it concise (1-2 sentences maximum).\n\nContinue this text professionally: "${contextBefore}"`,
				temperature,
				max_tokens: maxTokens
			})
		});

		if (!response.ok) {
			throw new Error(`API error: ${response.status}`);
		}

		const data = await response.json();
		let suggestion = this.extractContentFromResponse(data);
		
		suggestion = suggestion.trim();
		
		// Remove any leading spaces if context ends with space
		if (contextBefore.endsWith(' ') || contextBefore.endsWith('\n')) {
			suggestion = suggestion.trimStart();
		}
		
		// Remove duplicated words from the start of suggestion that already exist at the end of context
		suggestion = removeDuplicatePrefix(contextBefore, suggestion);
		
		return suggestion;
	}
	
	async testConnection(apiKey: string, model: string): Promise<boolean> {
		try {
			const requestBody = {
				models: [model || this.getDefaultModel()],
				message: 'Hello, please respond with "OK" to confirm you are working.',
				temperature: this.getDefaultTemperature(),
				max_tokens: 50
			};
			
			console.log('Straico Test Connection Request:', JSON.stringify(requestBody, null, 2));
			
			const response = await fetch(this.getBaseUrl(), {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiKey}`
				},
				body: JSON.stringify(requestBody)
			});

			console.log('Straico Test Connection Response Status:', response.status);
			
			if (!response.ok) {
				const errorText = await response.text();
				console.error('Straico Test Connection Error:', response.status, errorText);
				return false;
			}

			const data = await response.json();
			console.log('Straico Test Connection Response:', data);
			
			// Check for successful response in Straico format
			return data.success === true && data.data?.completions !== undefined;
		} catch (error) {
			console.error('Straico Test Connection Exception:', error);
			return false;
		}
	}
	
	private getApiKey(): string {
		return this.apiKey;
	}
	
	private getModel(): string {
		return this.model || this.getDefaultModel();
	}
	
	private getBaseUrl(): string {
		return this.baseUrl || this.getDefaultBaseUrl();
	}
}

export class ProviderFactory {
	private static providers: Record<string, () => AIProvider> = {
		'zai': () => new ZAIProvider(),
		'openai': () => new OpenAIProvider(),
		'straico': () => new StraicoProvider()
	};
	
	static getAvailableProviders(): { name: string; displayName: string }[] {
		return Object.keys(this.providers).map(key => {
			const instance = this.providers[key]();
			return {
				name: instance.name,
				displayName: instance.displayName
			};
		});
	}
	
	static createProvider(providerName: string): AIProvider | null {
		const providerFactory = this.providers[providerName];
		if (!providerFactory) {
			return null;
		}
		
		return providerFactory();
	}
}