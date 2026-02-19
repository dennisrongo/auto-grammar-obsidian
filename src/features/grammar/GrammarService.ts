import { Editor, Notice } from 'obsidian';
import type { AIProvider } from '../../providers';
import type { AISettings } from '../../types';
import { cleanAIResponse, preserveCapitalization, extractWhitespace, isAtStartOfSentence } from '../../utils';

export class GrammarService {
	constructor(
		private getProvider: () => AIProvider | null,
		private getSettings: () => AISettings,
		private getCurrentApiKey: () => string,
		private handleRateLimit: () => void
	) {}
	
	async correctSelectedText(editor: Editor): Promise<void> {
		const selectedText = editor.getSelection();
		if (!selectedText) {
			new Notice('Please select some text to correct');
			return;
		}

		new Notice('Correcting grammar...');
		
		const { leading, trailing, content: trimmedText } = extractWhitespace(selectedText);
		
		const selectionStart = editor.getCursor('from');
		const lineStart = { line: selectionStart.line, ch: 0 };
		const textBeforeSelection = editor.getRange(lineStart, selectionStart);
		const isStartOfSentence = isAtStartOfSentence(textBeforeSelection);
		
		const startsWithLowercase = /^[a-z]/.test(trimmedText);
		
		const contextInfo = `Context: This text is ${isStartOfSentence ? 'at the START of a sentence' : 'in the MIDDLE of a sentence'}. ` +
			`The original text ${/^[A-Z]/.test(trimmedText) ? 'starts with an uppercase letter' : startsWithLowercase ? 'starts with a lowercase letter' : 'does not start with a letter'}.`;
		
		const corrected = await this.callAI(
			trimmedText, 
			'Correct only the grammar and spelling errors in the following text.\n\n' +
			`${contextInfo}\n\n` +
			'IMPORTANT RULES:\n' +
			'1. Return ONLY the corrected text with no explanations or commentary\n' +
			'2. Do NOT add any formatting, markdown, or code blocks\n' +
			'3. Do NOT add or remove line breaks\n' +
			'4. Do NOT change the meaning or structure\n' +
			'5. CAPITALIZATION RULES:\n' +
			'   - If the text is in the MIDDLE of a sentence, keep the first letter lowercase (unless it\'s a proper noun)\n' +
			'   - If the text is at the START of a sentence, capitalize the first letter\n' +
			'   - Preserve proper nouns and acronyms\n' +
			'6. If there are no errors, return the text exactly as is'
		);
		
		if (corrected) {
			let cleanedResult = cleanAIResponse(corrected);
			cleanedResult = preserveCapitalization(trimmedText, cleanedResult, isStartOfSentence);
			
			const finalResult = leading + cleanedResult + trailing;
			editor.replaceSelection(finalResult);
			new Notice('Grammar corrected');
		}
	}
	
	async correctEntireDocument(editor: Editor): Promise<void> {
		const fullText = editor.getValue();
		if (!fullText.trim()) {
			new Notice('Document is empty');
			return;
		}

		new Notice('Correcting document grammar...');
		const corrected = await this.callAI(
			fullText, 
			'Correct only the grammar and spelling errors in the following markdown document. ' +
			'IMPORTANT RULES:\n' +
			'1. Return ONLY the corrected document with no explanations or commentary\n' +
			'2. Do NOT add any extra formatting or code blocks\n' +
			'3. Preserve ALL markdown syntax exactly (headers, links, bold, italic, lists, code blocks, etc.)\n' +
			'4. Do NOT change the document structure or add/remove sections\n' +
			'5. Preserve the original line breaks and paragraph structure\n' +
			'6. If there are no errors, return the text exactly as is'
		);
		
		if (corrected) {
			let cleanedResult = cleanAIResponse(corrected);
			cleanedResult = cleanedResult.replace(/^```(?:markdown|md)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
			
			if (cleanedResult !== fullText) {
				editor.setValue(cleanedResult);
				new Notice('Document grammar corrected');
			}
		}
	}
	
	async improveWriting(editor: Editor): Promise<void> {
		const selectedText = editor.getSelection();
		if (!selectedText) {
			new Notice('Please select some text to improve');
			return;
		}

		new Notice('Improving writing...');
		
		const { leading, trailing, content: trimmedText } = extractWhitespace(selectedText);
		
		const selectionStart = editor.getCursor('from');
		const lineStart = { line: selectionStart.line, ch: 0 };
		const textBeforeSelection = editor.getRange(lineStart, selectionStart);
		const isStartOfSentence = isAtStartOfSentence(textBeforeSelection);
		
		const startsWithLowercase = /^[a-z]/.test(trimmedText);
		
		const contextInfo = `Context: This text is ${isStartOfSentence ? 'at the START of a sentence' : 'in the MIDDLE of a sentence'}.`;
		
		const improved = await this.callAI(
			trimmedText,
			'Improve the clarity, style, and flow of the following text.\n\n' +
			`${contextInfo}\n\n` +
			'IMPORTANT RULES:\n' +
			'1. Return ONLY the improved text with no explanations or commentary\n' +
			'2. Do NOT add any formatting, markdown, or code blocks\n' +
			'3. Do NOT add or remove line breaks\n' +
			'4. Preserve the original meaning and key information\n' +
			'5. Make it more professional and readable\n' +
			'6. Do NOT change technical terms or proper nouns\n' +
			'7. CAPITALIZATION RULES:\n' +
			'   - If the text is in the MIDDLE of a sentence, keep the first letter lowercase (unless it\'s a proper noun)\n' +
			'   - If the text is at the START of a sentence, capitalize the first letter'
		);
		
		if (improved) {
			let cleanedResult = cleanAIResponse(improved);
			cleanedResult = preserveCapitalization(trimmedText, cleanedResult, isStartOfSentence);
			
			const finalResult = leading + cleanedResult + trailing;
			editor.replaceSelection(finalResult);
			new Notice('Writing improved');
		}
	}
	
	private async callAI(text: string, instruction: string): Promise<string> {
		const apiKey = this.getCurrentApiKey();
		if (!apiKey) {
			new Notice('Please set your API key in the plugin settings');
			return '';
		}

		const provider = this.getProvider();
		if (!provider) {
			new Notice('No AI provider configured');
			return text;
		}

		try {
			console.log('Making API call with provider:', this.getSettings().provider);
			console.log('Using model:', this.getSettings().model);
			
			const result = await provider.callAPI(text, instruction, this.getSettings().temperature, 2000);
			
			console.log('Final processed result:', result);
			return result;
		} catch (error: any) {
			console.error('AI API Error:', error);
			
			if (error instanceof Error) {
				if (error.message.includes('rate limit') || error.message.includes('429')) {
					this.handleRateLimit();
					new Notice('Rate limit reached. Pausing requests temporarily.');
				} else {
					new Notice('Failed to connect to AI service. Please check your settings.');
				}
			}
			
			return text;
		}
	}
}
