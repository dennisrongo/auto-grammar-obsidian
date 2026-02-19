import { BaseProvider } from './BaseProvider';
import { ModelInfo } from '../types';

export class OpenAIProvider extends BaseProvider {
	name = 'openai';
	displayName = 'OpenAI';
	
	private static readonly FALLBACK_MODELS: ModelInfo[] = [
		{ id: 'gpt-4o', name: 'GPT-4o' },
		{ id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
		{ id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
		{ id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' }
	];
	
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
	
	async getAvailableModels(apiKey: string): Promise<ModelInfo[]> {
		try {
			const response = await fetch('https://api.openai.com/v1/models', {
				method: 'GET',
				headers: {
					'Authorization': `Bearer ${apiKey}`
				}
			});

			if (!response.ok) {
				console.error('Failed to fetch OpenAI models:', response.status);
				return OpenAIProvider.FALLBACK_MODELS;
			}

			const data = await response.json();
			const models = data.data || [];
			
			return models
				.filter((model: any) => 
					model.id.includes('gpt') && 
					!model.id.includes('fine-tune') && 
					!model.id.includes(':')
				)
				.map((model: any) => {
					let name = model.id.replace('gpt-', 'GPT-').replace(/-/g, ' ');
					if (model.id.includes('4o')) name += ' (Omni)';
					if (model.id.includes('turbo')) name += ' (Turbo)';
					return { id: model.id, name };
				})
				.sort((a: any, b: any) => {
					const order = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'];
					const aIndex = order.findIndex(id => a.id.includes(id));
					const bIndex = order.findIndex(id => b.id.includes(id));
					
					if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
					if (aIndex !== -1) return -1;
					if (bIndex !== -1) return 1;
					return a.id.localeCompare(b.id);
				});
		} catch (error) {
			console.error('Failed to fetch OpenAI models:', error);
			return OpenAIProvider.FALLBACK_MODELS;
		}
	}
}
