import type { AIProvider } from './types';
import type { ProviderInfo } from '../types';
import { ZAIProvider } from './ZAIProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { StraicoProvider } from './StraicoProvider';

export type { AIProvider } from './types';
export { BaseProvider } from './BaseProvider';
export { ZAIProvider } from './ZAIProvider';
export { OpenAIProvider } from './OpenAIProvider';
export { StraicoProvider } from './StraicoProvider';

export class ProviderFactory {
	private static providers: Record<string, () => AIProvider> = {
		'zai': () => new ZAIProvider(),
		'openai': () => new OpenAIProvider(),
		'straico': () => new StraicoProvider()
	};
	
	static getAvailableProviders(): ProviderInfo[] {
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
	
	static registerProvider(name: string, factory: () => AIProvider): void {
		this.providers[name] = factory;
	}
}
