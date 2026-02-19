import { removeDuplicatePrefix, cleanAIResponse, parseJsonArray, isAtStartOfSentence, shouldTriggerAutocomplete, preserveCapitalization, extractWhitespace } from '../../src/utils/textUtils';

describe('textUtils', () => {
  describe('removeDuplicatePrefix', () => {
    it('should return suggestion unchanged when no overlap', () => {
      const context = 'Hello world';
      const suggestion = 'Goodbye everyone';
      
      expect(removeDuplicatePrefix(context, suggestion)).toBe('Goodbye everyone');
    });

    it('should remove overlapping words at start of suggestion', () => {
      const context = 'The quick brown';
      const suggestion = 'brown fox jumps';
      
      expect(removeDuplicatePrefix(context, suggestion)).toBe('fox jumps');
    });

    it('should handle case-insensitive overlap', () => {
      const context = 'The quick BROWN';
      const suggestion = 'brown fox jumps';
      
      expect(removeDuplicatePrefix(context, suggestion)).toBe('fox jumps');
    });

    it('should handle partial word overlap', () => {
      const context = 'test';
      const suggestion = 'testing the function';
      
      expect(removeDuplicatePrefix(context, suggestion)).toBe('ingthe function');
    });
  });

  describe('cleanAIResponse', () => {
    it('should remove markdown code blocks', () => {
      const response = '```json\n{"key": "value"}\n```';
      expect(cleanAIResponse(response)).toBe('{"key": "value"}');
    });

    it('should remove "Here is the corrected text" prefix', () => {
      const response = "Here's the corrected text: The actual text";
      expect(cleanAIResponse(response)).toBe('The actual text');
    });

    it('should trim whitespace', () => {
      const response = '  text  ';
      expect(cleanAIResponse(response)).toBe('text');
    });
  });

  describe('parseJsonArray', () => {
    it('should parse valid JSON array', () => {
      const content = '[{"a": 1}, {"b": 2}]';
      const result = parseJsonArray(content);
      expect(result).toEqual([{a: 1}, {b: 2}]);
    });

    it('should extract JSON array from markdown code block', () => {
      const content = '```json\n[{"a": 1}]\n```';
      const result = parseJsonArray(content);
      expect(result).toEqual([{a: 1}]);
    });

    it('should return empty array for invalid JSON', () => {
      const content = 'not valid json';
      expect(parseJsonArray(content)).toEqual([]);
    });

    it('should extract JSON array from surrounding text', () => {
      const content = 'Some text [{"a": 1}] more text';
      const result = parseJsonArray(content);
      expect(result).toEqual([{a: 1}]);
    });
  });

  describe('isAtStartOfSentence', () => {
    it('should return true for empty text', () => {
      expect(isAtStartOfSentence('')).toBe(true);
    });

    it('should return true after period', () => {
      expect(isAtStartOfSentence('Hello. ')).toBe(true);
    });

    it('should return true after exclamation', () => {
      expect(isAtStartOfSentence('Hello! ')).toBe(true);
    });

    it('should return true after question mark', () => {
      expect(isAtStartOfSentence('Hello? ')).toBe(true);
    });

    it('should return true after newline', () => {
      expect(isAtStartOfSentence('Hello\n')).toBe(true);
    });

    it('should return false in middle of sentence', () => {
      expect(isAtStartOfSentence('Hello ')).toBe(false);
    });
  });

  describe('shouldTriggerAutocomplete', () => {
    it('should return true after space with enough context', () => {
      expect(shouldTriggerAutocomplete('Hello world ', 5)).toBe(true);
    });

    it('should return false with insufficient context', () => {
      expect(shouldTriggerAutocomplete('Hi ', 10)).toBe(false);
    });

    it('should return false in middle of word', () => {
      expect(shouldTriggerAutocomplete('Hello wor', 5)).toBe(false);
    });

    it('should return true after punctuation', () => {
      expect(shouldTriggerAutocomplete('Hello world. ', 5)).toBe(true);
    });
  });

  describe('preserveCapitalization', () => {
    it('should lowercase first letter when in middle of sentence', () => {
      expect(preserveCapitalization('original', 'Corrected', false)).toBe('corrected');
    });

    it('should keep uppercase when at start of sentence', () => {
      expect(preserveCapitalization('Original', 'Corrected', true)).toBe('Corrected');
    });

    it('should handle empty corrected text', () => {
      expect(preserveCapitalization('original', '', false)).toBe('');
    });
  });

  describe('extractWhitespace', () => {
    it('should extract leading and trailing whitespace', () => {
      const result = extractWhitespace('  hello world  ');
      expect(result.leading).toBe('  ');
      expect(result.trailing).toBe('  ');
      expect(result.content).toBe('hello world');
    });

    it('should handle no whitespace', () => {
      const result = extractWhitespace('hello');
      expect(result.leading).toBe('');
      expect(result.trailing).toBe('');
      expect(result.content).toBe('hello');
    });
  });
});
