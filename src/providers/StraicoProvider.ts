import { BaseProvider } from './BaseProvider';
import { ModelInfo } from '../types';

export class StraicoProvider extends BaseProvider {
	name = 'straico';
	displayName = 'Straico';
	
	private static readonly FALLBACK_MODELS: ModelInfo[] = [
		{ id: 'openai/gpt-4o-mini', name: 'OpenAI: GPT-4o Mini' },
		{ id: 'openai/gpt-4o', name: 'OpenAI: GPT-4o' },
		{ id: 'anthropic/claude-3-haiku', name: 'Anthropic: Claude 3 Haiku' }
	];
	
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
	
	private extractStraicoContent(data: any): string {
		if (data.data?.completions) {
			const completions = data.data.completions;
			const modelKeys = Object.keys(completions);
			if (modelKeys.length > 0) {
				const firstModelCompletion = completions[modelKeys[0]];
				const message = firstModelCompletion?.completion?.choices?.[0]?.message;
				return message?.content || message?.reasoning || '';
			}
		}
		return data.choices?.[0]?.message?.content || '';
	}
	
	protected async makeChatRequest(
		systemPrompt: string,
		userMessage: string,
		temperature: number,
		maxTokens: number
	): Promise<string> {
		const model = this.getModel();
		
		if (!model) {
			throw new Error('No model selected. Please select a model in the settings.');
		}
		
		if (!this.getApiKey()) {
			throw new Error('No API key configured. Please enter your Straico API key in the settings.');
		}
		
		const requestBody = {
			models: [model],
			message: `${systemPrompt}\n\n${userMessage}`,
			temperature,
			max_tokens: maxTokens
		};
		
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
		
		return this.extractStraicoContent(data) || '';
	}
	
	async testConnection(apiKey: string, model: string): Promise<boolean> {
		try {
			const requestBody = {
				models: [model || this.getDefaultModel()],
				message: 'Hello, please respond with "OK" to confirm you are working.',
				temperature: this.getDefaultTemperature(),
				max_tokens: 50
			};
			
			const response = await fetch(this.getBaseUrl(), {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiKey}`
				},
				body: JSON.stringify(requestBody)
			});

			if (!response.ok) {
				return false;
			}

			const data = await response.json();
			return data.success === true && data.data?.completions !== undefined;
		} catch {
			return false;
		}
	}
	
	async getAvailableModels(apiKey: string): Promise<ModelInfo[]> {
		try {
			const response = await fetch('https://api.straico.com/v2/models', {
				method: 'GET',
				headers: {
					'Authorization': `Bearer ${apiKey}`
				}
			});

			if (!response.ok) {
				console.error('Failed to fetch Straico models:', response.status);
				return StraicoProvider.FALLBACK_MODELS;
			}

			const data = await response.json();
			const models = data.data || [];
			
			return models
				.filter((model: any) => model.model_type === 'chat' && model.id)
				.map((model: any) => ({
					id: model.id,
					name: model.name || model.id
				}))
				.sort((a: any, b: any) => a.name.localeCompare(b.name));
		} catch (error) {
			console.error('Failed to fetch Straico models:', error);
			return StraicoProvider.FALLBACK_MODELS;
		}
	}
}
