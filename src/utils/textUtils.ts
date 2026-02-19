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
	const trimmedContext = contextBefore.trim();
	if (trimmedContext.length < minLength) {
		return false;
	}
	
	const lastChar = contextBefore.slice(-1);
	
	if (!lastChar) {
		return true;
	}
	
	if (/[\s\n]$/.test(contextBefore)) {
		const textBeforeSpace = contextBefore.trimEnd();
		const lastNonSpaceChar = textBeforeSpace.slice(-1);
		
		if (/[.!?]$/.test(textBeforeSpace)) {
			return true;
		}
		
		if (/[,;:]$/.test(textBeforeSpace)) {
			return true;
		}
		
		if (/[a-zA-Z0-9'"')\]]$/.test(textBeforeSpace)) {
			return true;
		}
		
		return false;
	}
	
	return false;
}

export function isAtSentenceStart(contextBefore: string): boolean {
	const trimmed = contextBefore.trimEnd();
	
	if (trimmed.length === 0) {
		return true;
	}
	
	if (/[.!?]\s*$/.test(trimmed)) {
		return true;
	}
	
	if (/\n\s*$/.test(contextBefore)) {
		return true;
	}
	
	return false;
}

export function adjustSuggestionCasing(suggestion: string, isStartOfSentence: boolean): string {
	if (!suggestion || suggestion.length === 0) {
		return suggestion;
	}
	
	let cleaned = suggestion.trimStart();
	
	if (!isStartOfSentence) {
		cleaned = cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
	} else {
		cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
	}
	
	const originalLeadingWhitespace = suggestion.match(/^(\s*)/)?.[1] || '';
	return originalLeadingWhitespace + cleaned;
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

export function getDateContext(): string {
	const now = new Date();
	const options: Intl.DateTimeFormatOptions = {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	};
	const dateStr = now.toLocaleDateString('en-US', options);
	const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
	return `Current date and time: ${dateStr}, ${timeStr}`;
}
