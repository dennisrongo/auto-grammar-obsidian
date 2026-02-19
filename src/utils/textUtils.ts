export function removeDuplicatePrefix(context: string, suggestion: string): string {
	const contextWords = context.trim().toLowerCase().split(/\s+/);
	const suggestionWords = suggestion.trim().split(/\s+/);
	
	for (let overlapCount = Math.min(contextWords.length, suggestionWords.length); overlapCount > 0; overlapCount--) {
		const contextEnd = contextWords.slice(-overlapCount);
		const suggestionStart = suggestionWords.slice(0, overlapCount).map(w => w.toLowerCase());
		
		if (JSON.stringify(contextEnd) === JSON.stringify(suggestionStart)) {
			return suggestionWords.slice(overlapCount).join(' ');
		}
	}
	
	if (contextWords.length > 0 && suggestionWords.length > 0) {
		const lastContextWord = contextWords[contextWords.length - 1];
		const firstSuggestionWord = suggestionWords[0].toLowerCase();
		
		if (firstSuggestionWord.startsWith(lastContextWord) && firstSuggestionWord !== lastContextWord) {
			const remaining = firstSuggestionWord.substring(lastContextWord.length);
			if (remaining.length > 0) {
				return remaining + suggestionWords.slice(1).join(' ');
			}
		}
	}
	
	return suggestion;
}

export function cleanAIResponse(response: string): string {
	let cleaned = response.trim();
	cleaned = cleaned.replace(/^```(?:\w*)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
	cleaned = cleaned.replace(/^(Here'?s? (is )?(the )?correct(ed)? (text|version|grammar)[:.]?\s*)/i, '');
	cleaned = cleaned.replace(/^(Corrected (text|version|grammar)[:.]?\s*)/i, '');
	cleaned = cleaned.replace(/^(Here'?s? (is )?(the )?improved (text|version|writing)[:.]?\s*)/i, '');
	cleaned = cleaned.replace(/^(Improved (text|version|writing)[:.]?\s*)/i, '');
	return cleaned.trim();
}

export function parseJsonArray<T>(content: string): T[] {
	let parsed = content.trim();
	parsed = parsed.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
	parsed = parsed.trim();
	
	if (!parsed.startsWith('[') && !parsed.startsWith('{')) {
		const jsonMatch = parsed.match(/\[[\s\S]*\]/);
		if (jsonMatch) {
			parsed = jsonMatch[0];
		}
	}
	
	try {
		const result = JSON.parse(parsed);
		return Array.isArray(result) ? result : [];
	} catch {
		return [];
	}
}

export function isAtStartOfSentence(textBefore: string): boolean {
	const isStartOfLine = textBefore.length === 0;
	const isAfterSentenceEnd = /[.!?]\s*$/.test(textBefore);
	const isAfterNewline = /\n\s*$/.test(textBefore);
	return isStartOfLine || isAfterSentenceEnd || isAfterNewline;
}

export function shouldTriggerAutocomplete(contextBefore: string, minLength: number = 10): boolean {
	const lastChar = contextBefore.slice(-1);
	const validTrigger = !lastChar || /[\s\n.,!?;:]/.test(lastChar);
	const enoughContext = contextBefore.trim().length >= minLength;
	return validTrigger && enoughContext;
}

export function preserveCapitalization(originalText: string, correctedText: string, isStartOfSentence: boolean): string {
	if (correctedText.length === 0) return correctedText;
	
	const startsWithLowercase = /^[a-z]/.test(originalText.trim());
	
	if (!isStartOfSentence && startsWithLowercase) {
		return correctedText.charAt(0).toLowerCase() + correctedText.slice(1);
	}
	
	return correctedText;
}

export function extractWhitespace(text: string): { leading: string; trailing: string; content: string } {
	const leading = text.match(/^(\s*)/)?.[1] || '';
	const trailing = text.match(/(\s*)$/)?.[1] || '';
	const content = text.trim();
	return { leading, trailing, content };
}

export function escapeHtml(text: string): string {
	const div = document.createElement('div');
	div.textContent = text;
	return div.innerHTML;
}
