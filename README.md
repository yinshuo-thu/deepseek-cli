# DeepSeek-CLI

<!-- The whale below renders in DeepSeek-blue (#4D6BFE) inside the TUI splash.
     Markdown can't carry terminal colour, so this README shows it in plain ASCII. -->

```
                     .--:      =
         :+***********=      =**-        -
      .+**************+-     -****-.=++**=
     =*******************+    =*********+.
    =**********************=   .+*****+:
   :*+.  .:++***********+****+. +***
   +*=         -+******-.  +*******=
   +*+           :*****==-  -******
   :**=            -*****+:  +****-
    +**=            .************=
     +**=             =*********=
      +**+-     =+=    :******+
       .+***=.  -****:   -+****+:
          =************++=-..-==-.
             .==+++++==:
```

> A native, terminal-first coding agent for the **DeepSeek V4** model family — built to match the look-and-feel of Claude Code, command-for-command, while running entirely on your DeepSeek API key.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Status](https://img.shields.io/badge/status-M2%20alpha-orange)

---

## Why this exists

There are two great DeepSeek terminal projects already (`Hmbown/DeepSeek-TUI` in Rust, `CJackHwang/ds2api` in Go), and both inspired this one. **DeepSeek-CLI** is different in three ways:

1. **Identical UX to Claude Code.** Slash commands, tool cards, permission prompts, status bar, splash screen — all match the Claude reference, so muscle memory carries over.
2. **TypeScript + Ink stack.** Same stack Anthropic uses for Claude Code itself; visual fidelity is highest here.
3. **Native API + reverse-proxy login.** Officially supports `DEEPSEEK_API_KEY`, with optional ds2api-style web-session reverse proxy for users who prefer browser auth.

> Roadmap: see [TODO.md](TODO.md). M2 (this release) adds the login proxy, plan/agent/yolo modes, reasoning tiers, and the two-pane splash. M3–M5 add subagents, MCP/Skills/Hooks, and binary distribution.

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

Switch in-session: `/model deepseek-v4-pro`. When `/reasoning max` is set, the agent transparently routes to `deepseek-reasoner` for that turn.

## What works

Shipped through M2.0:

- **Slash commands:** `/help` `/clear` `/model` `/mode` `/reasoning` `/config` `/cost` `/resume` `/cwd` `/login` `/logout` `/whoami` `/exit`
- **Tools:** Read · Write · Edit · Bash · Glob · Grep · list_dir · apply_patch · WebFetch · WebSearch
- **Modes:** Plan / Agent / YOLO — Tab cycles through them with the input box empty
- **Reasoning effort:** `off` / `high` / `max` — Shift+Tab cycles. `max` routes the turn to `deepseek-reasoner`
- **Streaming agent loop** with permission prompts (allow once / always / deny) and Read-before-Write safety
- **Per-project session persistence** at `~/.deepseek/projects/<slug>/sessions/` plus a `/resume` picker
- **First-run API-key wizard** and ds2api-style **`/login` flow** with a local OpenAI-compatible reverse proxy (M2.0 ships a mock proxy; M2.1 wires the real DeepSeek-web format)
- **Two-pane Claude-Code-style splash** with Recent activity + What's new
- DeepSeek-blue theme and whale brand art; Esc cancels the stream, Ctrl+C twice to exit

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
├── auth/              # /login proxy server + session store
├── tools/             # Read · Write · Edit · Bash · Glob · Grep · list_dir · apply_patch · WebFetch · WebSearch
├── commands/          # slash-command registry
├── ui/                # Splash, Message, StatusBar, Permission, ResumePicker, theme, markdown
├── session/           # per-project persistent message log
└── config/            # ~/.deepseek/config.json + project key hashing
```

## Multi-agent orchestration

This project is *itself* built by a small fleet of role-specific Claude Code agents driven by the orchestrator in [`.claude/`](.claude/):

- **`.claude/agents/`** — agent definition files. Each is a Markdown front-matter spec for a role (`plan`, `dev`, `eval`, `summary`, `github`) plus its tools and behavioural rules.
- **`.claude/runs/`** — a chronological log of every round. Files like `2026-05-02-r03-dev-m20-skeleton.md` capture the prompt, the agent's output, and the evaluator's findings.

The typical loop is *Plan → DEV → Eval → Summary* per milestone, with the GitHub agent handling commits and PRs. New contributors can read `runs/` to see exactly how each feature got built and why each design call was made.

## Comparison with related projects

|                              | DeepSeek-CLI (this) | DeepSeek-TUI (Rust)  | ds2api (Go) |
|------------------------------|:-------------------:|:--------------------:|:-----------:|
| UX 1:1 with Claude Code      | yes                 | partial              | n/a         |
| Native streaming agent loop  | yes                 | yes                  | n/a         |
| ds2api-style web login proxy | yes (M2.0 mock, M2.1 real) | no            | yes         |
| Plan / Agent / YOLO modes    | yes                 | no                   | n/a         |
| Reasoning-effort tiers       | yes                 | no                   | n/a         |
| MCP servers                  | M4                  | yes                  | no          |
| Subagents                    | M3                  | yes                  | no          |
| Skills + Hooks (Claude-style)| M4                  | no                   | no          |
| TypeScript / Ink stack       | yes                 | no (Rust/ratatui)    | no (Go)     |

## Configuration

`~/.deepseek/config.json`:

```json
{
  "baseUrl": "https://api.deepseek.com",
  "model": "deepseek-v4-flash",
  "theme": "dark",
  "telemetry": false,
  "apiFlavor": "openai",
  "permissionMode": "agent",
  "reasoningEffort": "off"
}
```

Override per run with `--api-key`, `--base-url`, `--model` or env vars.

## Contributing

Issues and PRs welcome. The fastest way to make a change is `npm run dev` then iterate on `src/`. Before opening a PR, run `npm run typecheck`.

## License

MIT — see [LICENSE](LICENSE).

---

> _DeepSeek-CLI is an independent project. Not affiliated with DeepSeek or Anthropic._
