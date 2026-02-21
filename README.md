# 02mini

Complete multi-channel AI gateway - A simplified implementation of OpenClaw

## Features

### ✅ Completed

| Module | Features |
|--------|----------|
| **Configuration** | JSON5 support, environment variables, $include, validation |
| **CLI Commands** | setup, onboard, config, doctor, gateway, status, send, health, sessions, channels, memory |
| **Gateway** | HTTP API, WebSocket, session management, health checks |
| **AI Providers** | OpenAI, Anthropic with streaming support |
| **Channels** | Telegram, Discord, Slack (with policy support) |
| **Tools** | Bash tool with approval system |

### 🚧 Partially Implemented

- WhatsApp/Signal/iMessage channels (framework ready)
- File/browser/web tools (framework ready)
- Memory system (framework ready)
- Plugin system (framework ready)

## Quick Start

```bash
# Setup
npm install
npm run build

# Initialize configuration
node dist/cli/index.js setup

# Configure environment variables
set OPENAI_API_KEY=your_key
set MINI_GATEWAY_TOKEN=your_token

# Start gateway
node dist/cli/index.js gateway start

# Or use npm script
npm run gateway
```

## CLI Commands

```bash
02mini setup              # Initialize configuration
02mini onboard            # Interactive setup wizard
02mini config show        # Display configuration
02mini config get <key>   # Get config value
02mini config set <key> <value>  # Set config value
02mini doctor             # Diagnose issues
02mini gateway start      # Start gateway server
02mini status             # Show system status
02mini health             # Check gateway health
02mini send "Hello AI"    # Send message to AI
02mini sessions list      # List conversations
02mini channels list      # List channels
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `GET /api/status` | System status |
| `POST /api/chat` | Chat endpoint |
| `GET /api/conversations` | List conversations |
| `GET /api/conversations/:id` | Get conversation |
| `DELETE /api/conversations/:id` | Clear conversation |
| `POST /v1/chat/completions` | OpenAI compatible |
| `GET /v1/models` | List models |
| `WS /` | WebSocket endpoint |

## Configuration

```json
{
  "gateway": {
    "port": 18789,
    "host": "127.0.0.1",
    "auth": {
      "type": "token",
      "token": "${MINI_GATEWAY_TOKEN}"
    }
  },
  "ai": {
    "type": "openai",
    "apiKey": "${OPENAI_API_KEY}",
    "model": "gpt-4o-mini"
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "${TELEGRAM_BOT_TOKEN}"
    },
    "discord": {
      "enabled": true,
      "botToken": "${DISCORD_BOT_TOKEN}"
    },
    "slack": {
      "enabled": true,
      "botToken": "${SLACK_BOT_TOKEN}"
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key |
| `ANTHROPIC_API_KEY` | No | Anthropic API key |
| `MINI_GATEWAY_TOKEN` | Yes | Gateway auth token |
| `TELEGRAM_BOT_TOKEN` | No | Telegram bot token |
| `DISCORD_BOT_TOKEN` | No | Discord bot token |
| `SLACK_BOT_TOKEN` | No | Slack bot token |

## Project Structure

```
02mini/
├── src/
│   ├── cli/
│   │   ├── commands/     # CLI command implementations
│   │   └── index.ts      # CLI entry
│   ├── config/
│   │   ├── types.ts      # Configuration types
│   │   ├── loader.ts     # Config loader with $include
│   │   └── manager.ts    # Config manager
│   ├── channels/
│   │   ├── types.ts      # Channel interfaces
│   │   ├── telegram.ts   # Telegram bot
│   │   ├── discord.ts    # Discord bot
│   │   ├── slack.ts      # Slack bot
│   │   └── manager.ts    # Channel manager
│   ├── ai/
│   │   ├── types.ts      # AI provider interfaces
│   │   ├── openai.ts     # OpenAI provider
│   │   ├── anthropic.ts  # Anthropic provider
│   │   └── factory.ts    # Provider factory
│   ├── gateway/
│   │   └── server.ts     # HTTP/WebSocket server
│   ├── tools/
│   │   ├── types.ts      # Tool interfaces
│   │   ├── bash.ts       # Bash tool
│   │   └── manager.ts    # Tool manager
│   └── utils/
│       ├── session.ts    # Session management
│       └── id.ts         # ID generation
├── web/                  # Web UI (Material Design 3)
├── dist/                 # Compiled output
└── package.json
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         02mini                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Telegram   │  │   Discord    │  │    Slack     │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         └─────────────────┴─────────────────┘               │
│                           │                                 │
│                    ┌──────┴──────┐                         │
│                    │   Gateway   │                         │
│                    │  (HTTP/WS)  │                         │
│                    └──────┬──────┘                         │
│                           │                                 │
│         ┌─────────────────┼─────────────────┐              │
│         ▼                 ▼                 ▼              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   Session   │  │     AI      │  │    Tools    │        │
│  │   Manager   │  │  Providers  │  │   Manager   │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Comparison with OpenClaw

| Feature | OpenClaw | 02mini |
|---------|----------|--------|
| CLI Commands | 30+ | 10+ |
| Channels | 13+ | 3 (Telegram/Discord/Slack) |
| AI Providers | 20+ | 2 (OpenAI/Anthropic) |
| Tools | 20+ | 1 (bash) |
| Memory | ✅ | Framework |
| Plugins | ✅ | Framework |
| Skills | 50+ | Framework |
| Code Size | ~50K lines | ~3K lines |

## Development

```bash
# Development mode
npm run dev

# Build
npm run build

# Test CLI
node dist/cli/index.js --help
```

## Next Steps

To complete the implementation:

1. **Channels**: Add WhatsApp, Signal, iMessage support
2. **Tools**: Implement file, browser, web tools
3. **Memory**: Add vector search with sqlite-vec
4. **Cron**: Add scheduled job support
5. **Security**: Add DM pairing, allowlists, approvals
6. **Plugins**: Add plugin SDK and loader
7. **Skills**: Add skill system

## License

MIT