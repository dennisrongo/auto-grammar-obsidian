import { ZAIProvider } from '../../src/providers/ZAIProvider';
import { OpenAIProvider } from '../../src/providers/OpenAIProvider';
import { StraicoProvider } from '../../src/providers/StraicoProvider';
import { ProviderFactory } from '../../src/providers';

describe('Providers', () => {
  describe('ZAIProvider', () => {
    let provider: ZAIProvider;

    beforeEach(() => {
      provider = new ZAIProvider();
    });

    it('should have correct name and displayName', () => {
      expect(provider.name).toBe('zai');
      expect(provider.displayName).toBe('Z.ai');
    });

    it('should return correct defaults', () => {
      expect(provider.getDefaultBaseUrl()).toBe('https://api.z.ai/api/paas/v4/chat/completions');
      expect(provider.getDefaultModel()).toBe('GLM-4-32B-0414-128K');
      expect(provider.getDefaultTemperature()).toBe(0.1);
    });

    it('should set configuration correctly', () => {
      provider.setConfiguration('test-key', 'test-model', 'https://test.url');
      expect(provider.getDefaultBaseUrl()).toBe('https://api.z.ai/api/paas/v4/chat/completions');
    });
  });

  describe('OpenAIProvider', () => {
    let provider: OpenAIProvider;

    beforeEach(() => {
      provider = new OpenAIProvider();
    });

    it('should have correct name and displayName', () => {
      expect(provider.name).toBe('openai');
      expect(provider.displayName).toBe('OpenAI');
    });

    it('should return correct defaults', () => {
      expect(provider.getDefaultBaseUrl()).toBe('https://api.openai.com/v1/chat/completions');
      expect(provider.getDefaultModel()).toBe('gpt-4');
      expect(provider.getDefaultTemperature()).toBe(0.1);
    });

    it('should return fallback models when API fails', async () => {
      const models = await provider.getAvailableModels!('invalid-key');
      expect(models.length).toBeGreaterThan(0);
      expect(models.some(m => m.id === 'gpt-4o')).toBe(true);
    });
  });

  describe('StraicoProvider', () => {
    let provider: StraicoProvider;

    beforeEach(() => {
      provider = new StraicoProvider();
    });

    it('should have correct name and displayName', () => {
      expect(provider.name).toBe('straico');
      expect(provider.displayName).toBe('Straico');
    });

    it('should return correct defaults', () => {
      expect(provider.getDefaultBaseUrl()).toBe('https://api.straico.com/v1/prompt/completion');
      expect(provider.getDefaultModel()).toBe('openai/gpt-4o-mini');
      expect(provider.getDefaultTemperature()).toBe(0.1);
    });

    it('should return fallback models when API fails', async () => {
      const models = await provider.getAvailableModels!('invalid-key');
      expect(models.length).toBeGreaterThan(0);
      expect(models.some(m => m.id === 'openai/gpt-4o-mini')).toBe(true);
    });
  });

  describe('ProviderFactory', () => {
    it('should return all available providers', () => {
      const providers = ProviderFactory.getAvailableProviders();
      expect(providers.length).toBe(3);
      expect(providers.map(p => p.name)).toContain('zai');
      expect(providers.map(p => p.name)).toContain('openai');
      expect(providers.map(p => p.name)).toContain('straico');
    });

    it('should create ZAIProvider', () => {
      const provider = ProviderFactory.createProvider('zai');
      expect(provider).toBeInstanceOf(ZAIProvider);
    });

    it('should create OpenAIProvider', () => {
      const provider = ProviderFactory.createProvider('openai');
      expect(provider).toBeInstanceOf(OpenAIProvider);
    });

    it('should create StraicoProvider', () => {
      const provider = ProviderFactory.createProvider('straico');
      expect(provider).toBeInstanceOf(StraicoProvider);
    });

    it('should return null for unknown provider', () => {
      const provider = ProviderFactory.createProvider('unknown');
      expect(provider).toBeNull();
    });
  });
});
