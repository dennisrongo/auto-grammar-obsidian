# AI Grammar Assistant

An Obsidian plugin that provides AI-powered grammar correction and writing assistance for your notes.

## Features

- **Right-click context menu** with grammar correction options
- **Selected text correction** - Fix grammar and spelling in highlighted portions
- **Entire document correction** - Process complete notes at once
- **Writing improvement** - Enhance clarity, style, and flow
- **Configurable AI provider** - Start with GLM-4-32B, supports other providers
- **Real-time grammar checking** - Visual indicators as you type
- **AI autocomplete/IntelliSense** - Predictive text suggestions
- **Command palette integration** - Quick access via hotkeys

## Installation

1. Clone this repository into your Obsidian plugins directory
2. Run `npm install` to install dependencies
3. Run `npm run build` to build the plugin
4. Enable the plugin in Obsidian settings

## Setup

1. Get an API key from [Zhipu AI](https://z.ai/manage-apikey/apikey-list)
2. Open plugin settings in Obsidian
3. Enter your API key
4. Configure model and base URL if needed (defaults are set for GLM-4-32B)

## Usage

### Right-click Menu
- Right-click anywhere in a note to see the context menu
- Choose from:
  - **Correct Grammar (Selected)** - Fixes highlighted text
  - **Correct Grammar (Document)** - Processes entire note
  - **Improve Writing** - Enhances selected text quality

### Command Palette
- Open command palette (Ctrl/Cmd + P)
- Search for "AI Grammar" commands
- Execute on selected text or entire document

## Configuration

The plugin supports the following settings:

- **API Key**: Your AI service authentication key
- **Model**: AI model to use (default: GLM-4-32B-0414-128K)
- **Base URL**: API endpoint URL (default: https://api.z.ai/api/paas/v4/chat/completions)
- **Temperature**: Controls randomness (0.0 = deterministic, 1.0 = creative)
- **Real-time Grammar Checking**: Enable/disable automatic checking
- **Autocomplete**: Enable/disable AI-powered text predictions

## Development

```bash
# Install dependencies
npm install

# Development build with hot reload
npm run dev

# Production build
npm run build
```

## License

MIT License