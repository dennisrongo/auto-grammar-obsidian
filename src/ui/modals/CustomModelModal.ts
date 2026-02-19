import { App, Modal } from 'obsidian';

export class CustomModelModal extends Modal {
	private onSubmit: (result: string) => void;
	private inputEl: HTMLInputElement;
	
	constructor(app: App, onSubmit: (result: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}
	
	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Enter Custom Model ID' });
		
		const inputContainer = contentEl.createDiv();
		inputContainer.createEl('p', { 
			text: 'Enter the model ID (e.g., "openai/gpt-4o"):' 
		});
		
		this.inputEl = inputContainer.createEl('input', {
			type: 'text',
			placeholder: 'openai/gpt-4o',
			value: ''
		});
		this.inputEl.style.width = '100%';
		this.inputEl.style.marginTop = '10px';
		
		const buttonContainer = contentEl.createDiv();
		buttonContainer.style.marginTop = '20px';
		buttonContainer.style.textAlign = 'right';
		
		const submitButton = buttonContainer.createEl('button', {
			text: 'Submit',
			cls: 'mod-cta'
		});
		submitButton.style.marginRight = '10px';
		
		const cancelButton = buttonContainer.createEl('button', {
			text: 'Cancel'
		});
		
		submitButton.onclick = () => {
			const value = this.inputEl.value.trim();
			if (value) {
				this.onSubmit(value);
			}
			this.close();
		};
		
		cancelButton.onclick = () => {
			this.onSubmit('');
			this.close();
		};
		
		setTimeout(() => {
			this.inputEl.focus();
		}, 10);
	}
	
	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
