import type { AISettings, GrammarSuggestion } from '../../src/types';

export class MockEditor {
  private content: string = '';
  private selection: string = '';
  private cursorPos: { line: number; ch: number } = { line: 0, ch: 0 };

  getValue(): string {
    return this.content;
  }

  setValue(text: string): void {
    this.content = text;
  }

  getSelection(): string {
    return this.selection;
  }

  setSelection(text: string): void {
    this.selection = text;
  }

  replaceSelection(text: string): void {
    this.content = this.content.replace(this.selection, text);
    this.selection = text;
  }

  getCursor(_from?: string): { line: number; ch: number } {
    return this.cursorPos;
  }

  setCursor(pos: { line: number; ch: number }): void {
    this.cursorPos = pos;
  }

  getRange(from: { line: number; ch: number }, to: { line: number; ch: number }): string {
    return this.content.substring(
      this.posToOffset(from),
      this.posToOffset(to)
    );
  }

  replaceRange(text: string, from: { line: number; ch: number }, to?: { line: number; ch: number }): void {
    const startOffset = this.posToOffset(from);
    const endOffset = to ? this.posToOffset(to) : startOffset;
    this.content = this.content.substring(0, startOffset) + text + this.content.substring(endOffset);
  }

  getLine(line: number): string {
    const lines = this.content.split('\n');
    return lines[line] || '';
  }

  posToOffset(pos: { line: number; ch: number }): number {
    const lines = this.content.split('\n');
    let offset = 0;
    for (let i = 0; i < pos.line; i++) {
      offset += lines[i].length + 1;
    }
    return offset + pos.ch;
  }

  offsetToPos(offset: number): { line: number; ch: number } {
    const lines = this.content.split('\n');
    let currentOffset = 0;
    for (let i = 0; i < lines.length; i++) {
      if (currentOffset + lines[i].length >= offset) {
        return { line: i, ch: offset - currentOffset };
      }
      currentOffset += lines[i].length + 1;
    }
    return { line: lines.length - 1, ch: lines[lines.length - 1].length };
  }
}

export function createMockSettings(overrides: Partial<AISettings> = {}): AISettings {
  return {
    provider: 'zai',
    apiKeys: { zai: 'test-key', openai: '', straico: '' },
    model: 'test-model',
    baseUrl: 'https://api.test.com/v1/chat/completions',
    realTimeEnabled: true,
    debounceMs: 1000,
    rateLimitBackoff: 60000,
    temperature: 0.1,
    autocompleteEnabled: true,
    autocompleteDebounceMs: 500,
    autocompleteMaxTokens: 50,
    ...overrides
  };
}

export function createMockGrammarSuggestion(overrides: Partial<GrammarSuggestion> = {}): GrammarSuggestion {
  return {
    start: 0,
    end: 5,
    suggestion: 'corrected',
    type: 'grammar',
    original: 'wrong',
    ...overrides
  };
}
