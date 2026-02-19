# AI Grammar Assistant - Project Architecture

## Project Structure

```
src/
├── index.ts                      # Main plugin entry point
├── types/
│   └── index.ts                  # TypeScript interfaces and types
├── providers/
│   ├── index.ts                  # Provider exports and factory
│   ├── types.ts                  # AIProvider interface
│   ├── BaseProvider.ts           # Base class with shared logic
│   ├── ZAIProvider.ts            # Z.ai provider
│   ├── OpenAIProvider.ts         # OpenAI provider
│   └── StraicoProvider.ts        # Straico provider
├── settings/
│   ├── index.ts                  # Settings exports
│   ├── defaults.ts               # Default settings and migration
│   └── SettingsTab.ts            # Settings UI
├── features/
│   ├── index.ts                  # Feature exports
│   ├── grammar/
│   │   ├── index.ts
│   │   ├── GrammarService.ts     # Grammar correction logic
│   │   └── RealTimeGrammarChecker.ts
│   └── autocomplete/
│       ├── index.ts
│       └── AutocompleteService.ts
├── ui/
│   ├── index.ts
│   └── modals/
│       ├── index.ts
│       └── CustomModelModal.ts
└── utils/
    ├── index.ts
    └── textUtils.ts              # Text processing utilities

tests/
├── __mocks__/
│   └── obsidian.ts               # Obsidian API mocks
├── providers/
│   └── providers.test.ts
├── settings/
│   └── settings.test.ts
├── utils/
│   └── textUtils.test.ts
└── setup.ts                      # Jest setup
```

## Commands

- **Build**: `npm run build` - Production build
- **Dev**: `npm run dev` - Development watch mode
- **Test**: `npm test` - Run unit tests
- **Test with coverage**: `npm run test:coverage`

## Architecture

### Plugin Entry Point (`src/index.ts`)
- Main `AIGrammarAssistant` class extending Obsidian's Plugin
- Initializes all services and wires up dependencies
- Registers commands, context menus, and settings

### Providers Layer (`src/providers/`)
- **AIProvider interface**: Contract for all AI providers
- **BaseProvider**: Shared functionality (API calls, connection testing)
- **ProviderFactory**: Creates provider instances by name
- Each provider handles its specific API format

### Features Layer (`src/features/`)
- **GrammarService**: Grammar correction (selected text, document, writing improvement)
- **RealTimeGrammarChecker**: Debounced real-time grammar checking with UI markers
- **AutocompleteService**: AI-powered text completion with ghost text

### Settings Layer (`src/settings/`)
- Default settings configuration
- Settings migration (old API key format to new multi-provider format)
- Settings tab UI implementation

### Utilities (`src/utils/`)
- Text processing functions (deduplication, JSON parsing, capitalization)
- Shared helper functions

## Key Design Patterns

1. **Dependency Injection**: Services receive dependencies as constructor functions, enabling testing
2. **Factory Pattern**: `ProviderFactory` creates provider instances
3. **Strategy Pattern**: Different providers implement the same `AIProvider` interface
4. **Composition**: Plugin composes services rather than inheriting behavior
