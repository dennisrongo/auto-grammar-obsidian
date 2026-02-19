import { DEFAULT_SETTINGS, migrateSettings } from '../../src/settings/defaults';

describe('Settings', () => {
  describe('DEFAULT_SETTINGS', () => {
    it('should have all required properties', () => {
      expect(DEFAULT_SETTINGS.provider).toBe('zai');
      expect(DEFAULT_SETTINGS.apiKeys).toBeDefined();
      expect(DEFAULT_SETTINGS.apiKeys.zai).toBe('');
      expect(DEFAULT_SETTINGS.apiKeys.openai).toBe('');
      expect(DEFAULT_SETTINGS.apiKeys.straico).toBe('');
      expect(DEFAULT_SETTINGS.realTimeEnabled).toBe(true);
      expect(DEFAULT_SETTINGS.autocompleteEnabled).toBe(true);
    });
  });

  describe('migrateSettings', () => {
    it('should return default settings when no data provided', () => {
      const result = migrateSettings(null);
      expect(result.provider).toBe('zai');
    });

    it('should migrate old apiKey to apiKeys format', () => {
      const oldData = {
        apiKey: 'test-old-key',
        provider: 'zai'
      };
      
      const result = migrateSettings(oldData);
      
      expect(result.apiKeys.zai).toBe('test-old-key');
      expect(result.apiKeys.openai).toBe('');
      expect(result.apiKeys.straico).toBe('');
      expect((oldData as any).apiKey).toBeUndefined();
    });

    it('should preserve existing apiKeys', () => {
      const data = {
        apiKeys: {
          zai: 'zai-key',
          openai: 'openai-key',
          straico: 'straico-key'
        },
        provider: 'openai'
      };
      
      const result = migrateSettings(data);
      
      expect(result.apiKeys.zai).toBe('zai-key');
      expect(result.apiKeys.openai).toBe('openai-key');
      expect(result.apiKeys.straico).toBe('straico-key');
    });

    it('should merge with defaults for missing properties', () => {
      const partialData = {
        provider: 'openai'
      };
      
      const result = migrateSettings(partialData);
      
      expect(result.provider).toBe('openai');
      expect(result.realTimeEnabled).toBe(true);
      expect(result.autocompleteEnabled).toBe(true);
    });
  });
});
