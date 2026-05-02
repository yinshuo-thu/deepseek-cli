# 🐋 DeepSeek-CLI

> A native, terminal-first coding agent for the **DeepSeek V4** model family — built to match the look-and-feel of Claude Code, command-for-command, while running entirely on your DeepSeek API key.

```
        .-""""""-.
      .'          '.
     /   O      O   \
    :           '    :       DeepSeek-CLI
    |                |       streaming · tools · agents
    :    .------.    :
     \  '        '  /
      '. '------' .'
        '-..____.-'
```

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Status](https://img.shields.io/badge/status-M1%20alpha-orange)

---

## Why this exists

There are two great DeepSeek terminal projects already (`Hmbown/DeepSeek-TUI` in Rust, `CJackHwang/ds2api` in Go), and both inspired this one. **DeepSeek-CLI** is different in three ways:

1. **Identical UX to Claude Code.** Slash commands, tool cards, permission prompts, status bar, splash screen — all match the Claude reference, so muscle memory carries over.
2. **TypeScript + Ink stack.** Same stack Anthropic uses for Claude Code itself; visual fidelity is highest here.
3. **Native API + reverse-proxy login.** Officially supports `DEEPSEEK_API_KEY`, with optional ds2api-style web-session reverse proxy for users who prefer browser auth (M2).

> Roadmap: see [TODO.md](TODO.md). M1 (this release) is a working MVP. M2–M5 add login proxy, subagents, MCP/Skills/Hooks, and binary distribution.

## Install

> M5 will ship a one-liner installer. For now, install from source:

```bash
git clone git@github.com:yinshuo-thu/deepseek-cli.git
cd deepseek-cli
npm install
npm run build
npm link        # exposes `deepseek` and `ds` globally
```

Dev mode (no build step):

```bash
npm run dev      # runs src/cli.tsx via tsx
```

## Quickstart

```bash
export DEEPSEEK_API_KEY=sk-...
deepseek
```

First run with no key shows a wizard that prompts for one and writes it to `~/.deepseek/config.json` (chmod 600).

One-shot mode for scripting:

```bash
deepseek --print "summarise this repo's README" < README.md
```

## Models

| Model                 | Use it for                          | Pricing (USD / 1M tok)       |
|-----------------------|-------------------------------------|------------------------------|
| `deepseek-v4-flash`   | default — fast, cheap, tool-capable | $0.14 in / $0.28 out         |
| `deepseek-v4-pro`     | hard reasoning, long context        | $0.435 in / $0.87 out        |

Switch in-session: `/model deepseek-v4-pro`.

## What works in M1

- Streaming chat with markdown + syntax-highlighted code blocks
- Tool-calling loop (Read / Write / Edit / Bash) with Read-before-Write safety
- Permission prompts (allow once / always / deny)
- Slash commands: `/help` `/clear` `/model` `/config` `/cost` `/exit` `/cwd`
- Per-project session persistence at `~/.deepseek/projects/<slug>/sessions/`
- DeepSeek-blue theme + whale splash
- Esc cancels stream, Ctrl+C twice to exit

## Architecture

```
src/
├── cli.tsx            # entry: yargs, first-run wizard, render <App/>
├── App.tsx            # main TUI — state + agent loop driver
├── api/
│   ├── client.ts      # streaming OpenAI-compatible client (SSE)
│   └── types.ts       # ChatMessage, ToolCall, StreamEvent
├── agents/
│   └── loop.ts        # stream → accumulate tool_calls → run → loop
├── tools/             # Read · Write · Edit · Bash + permission semantics
├── commands/          # slash-command registry
├── ui/                # Splash, Message, StatusBar, Permission, theme, markdown
├── session/           # per-project persistent message log
└── config/            # ~/.deepseek/config.json + project key hashing
```

## Comparison with related projects

|                              | DeepSeek-CLI (this) | DeepSeek-TUI (Rust)  | ds2api (Go) |
|------------------------------|:-------------------:|:--------------------:|:-----------:|
| UX 1:1 with Claude Code      | ✅                  | partial              | n/a         |
| Native streaming agent loop  | ✅                  | ✅                   | n/a         |
| ds2api-style web login proxy | M2                  | ❌                   | ✅          |
| MCP servers                  | M4                  | ✅                   | ❌          |
| Subagents                    | M3                  | ✅                   | ❌          |
| Skills + Hooks (Claude-style)| M4                  | ❌                   | ❌          |
| TypeScript / Ink stack       | ✅                  | ❌ (Rust/ratatui)    | ❌ (Go)     |

## Configuration

`~/.deepseek/config.json`:

```json
{
  "baseUrl": "https://api.deepseek.com",
  "model": "deepseek-v4-flash",
  "theme": "dark",
  "telemetry": false,
  "apiFlavor": "openai"
}
```

Override per run with `--api-key`, `--base-url`, `--model` or env vars.

## Contributing

Issues and PRs welcome. The fastest way to make a change is `npm run dev` then iterate on `src/`. Before opening a PR, run `npm run typecheck`.

## License

MIT — see [LICENSE](LICENSE).

---

> _DeepSeek-CLI is an independent project. Not affiliated with DeepSeek or Anthropic._
