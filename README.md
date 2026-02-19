# AI Grammar Assistant

An Obsidian plugin that provides AI-powered grammar correction and writing assistance for your notes.

## Features

### Grammar & Writing
- **Selected Text Correction** - Fix grammar and spelling in highlighted portions
- **Entire Document Correction** - Process complete notes at once
- **Writing Improvement** - Enhance clarity, style, and flow of selected text
- **Real-time Grammar Checking** - Visual indicators as you type (optional)

### AI Autocomplete
- **Intelligent Text Predictions** - Get context-aware suggestions as you write
- **Ghost Text Display** - See suggestions in a non-intrusive popup
- **One-key Acceptance** - Press `→` (Arrow Right) at end of line to accept

### Context Awareness
- **Date/Time Context** - AI knows the current date and time
- **Note Title Context** - AI understands the topic based on your note's title

### User Interface
- **Right-click Context Menu** - Quick access to all features
- **Command Palette Integration** - Assign hotkeys to any action
- **Customizable Settings** - Configure providers, models, and behavior

## Supported Providers

| Provider | Default Model | Get API Key |
|----------|---------------|-------------|
| **Z.ai** (default) | GLM-4-32B-0414-128K | [z.ai/manage-apikey](https://z.ai/manage-apikey/apikey-list) |
| **OpenAI** | gpt-4o | [platform.openai.com](https://platform.openai.com/api-keys) |
| **Straico** | openai/gpt-4o-mini | [straico.com](https://straico.com) |

## Installation

### From Release
1. Download the latest release
2. Extract to `.obsidian/plugins/ai-grammar-assistant/`
3. Enable in Obsidian settings

### From Source
```bash
cd /path/to/your/vault/.obsidian/plugins
git clone https://github.com/your-repo/ai-grammar-assistant.git
cd ai-grammar-assistant
npm install
npm run build
```

## Setup

1. Open **Settings → AI Grammar Assistant**
2. Select your preferred **Provider**
3. Enter your **API Key** for the selected provider
4. (Optional) Customize model and settings
5. Click **Test Connection** to verify

## Usage

### Context Menu
Right-click in any note to access:
- **Correct Grammar (Selected)** - Fix highlighted text
- **Correct Grammar (Document)** - Process entire note
- **Improve Writing** - Enhance style and clarity

### Command Palette
Press `Ctrl/Cmd + P` and search for:
- `AI Grammar: Correct Grammar (Selected Text)`
- `AI Grammar: Correct Grammar (Entire Document)`
- `AI Grammar: Improve Writing`
- `AI Grammar: Trigger AI Autocomplete`
- `AI Grammar: Accept Autocomplete Suggestion`

### Autocomplete
1. Start typing in a note
2. When a suggestion appears, press `→` to accept or `Esc` to dismiss
3. Suggestions work best after ending a sentence or typing a space

## Configuration

### General Settings
| Setting | Description | Default |
|---------|-------------|---------|
| Provider | AI service provider | Z.ai |
| Model | AI model to use | Provider default |
| Temperature | Randomness (0-1) | 0.1 |
| Base URL | API endpoint | Provider default |

### Real-time Grammar
| Setting | Description | Default |
|---------|-------------|---------|
| Enable | Toggle real-time checking | Off |
| Debounce | Delay before checking (ms) | 2000 |

### Autocomplete
| Setting | Description | Default |
|---------|-------------|---------|
| Enable | Toggle autocomplete | Off |
| Debounce | Delay before suggesting (ms) | 500 |
| Max Tokens | Max suggestion length | 50 |

## Development

```bash
npm install          # Install dependencies
npm run dev          # Development with hot reload
npm run build        # Production build
npm test             # Run tests
npm run test:coverage # Run tests with coverage
```

## License

MIT
