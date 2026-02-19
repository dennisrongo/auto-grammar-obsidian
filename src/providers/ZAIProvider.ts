import { BaseProvider } from './BaseProvider';

export class ZAIProvider extends BaseProvider {
	name = 'zai';
	displayName = 'Z.ai';
	
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
}
