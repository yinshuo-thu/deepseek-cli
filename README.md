# 🐋 DeepSeek-CLI

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
- **First-run API-key wizard** and ds2api-style **`/login` flow** with a local OpenAI-compatible reverse proxy that wires the real DeepSeek-web format end-to-end (M2.1a) — see [the `/login` caveats](#login-reverse-proxy-caveats) below
- **Two-pane Claude-Code-style splash** with Recent activity + What's new
- DeepSeek-blue theme and whale brand art; Esc cancels the stream, Ctrl+C twice to exit

## `/login` reverse-proxy caveats

The `/login` flow speaks the **reverse-engineered chat.deepseek.com web protocol** — it is not an officially supported DeepSeek API surface. It works the same way [`ds2api`](https://github.com/CJackHwang/ds2api) does: paste the `Cookie` header from your logged-in browser tab, and a local OpenAI-compatible proxy rewrites every `/v1/chat/completions` request into a DeepSeek-web `chat_session/create` + `chat/completion` SSE handshake (with a pure-JS `DeepSeekHashV1` solver for the proof-of-work challenge when DeepSeek demands one).

> **Best-effort, may break, may violate DeepSeek's Terms of Service.** Use at your own risk. The official API-key flavor (`DEEPSEEK_API_KEY`) remains the default and recommended path; `/login` is for users who prefer browser auth. DeepSeek can change the wire format, tighten Cloudflare gating, or revoke web sessions at any time, and we will not always patch the same week.

### How to extract your cookie

1. Open <https://chat.deepseek.com> in Chrome/Edge/Firefox and log in normally.
2. Open DevTools (F12) → **Network** tab → reload the page.
3. Click any request to `chat.deepseek.com/api/v0/...` → **Headers** → **Request Headers**.
4. Copy the entire value of the `Cookie:` header (everything after `Cookie: `, all on one line — typically several KB).
5. Run `/login` in deepseek-cli, paste the cookie into the local browser page that opens, and submit.

If validation fails with "session expired" your cookie is stale (re-login at chat.deepseek.com). If it fails with "DDoS-Guard challenge" Cloudflare is gating that IP — pass a fresh challenge in your browser first, then retry.

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

## Comparison with Claude Code

DeepSeek-CLI is designed as a feature-parallel open-source alternative to Claude Code, running on DeepSeek models instead of Claude. The table below tracks parity:

| Feature | DeepSeek-CLI | <img src="https://avatars.githubusercontent.com/u/76263028?s=16&v=4" height="14" valign="middle"> Claude Code |
|---------|:---:|:---:|
| **Core UX** | | |
| Streaming chat + Markdown rendering | ✅ | ✅ |
| LaTeX math display (inline & block) | ✅ | ✅ |
| Reasoning / thinking blocks | ✅ | ✅ |
| Cost & token tracking (`/cost`) | ✅ | ✅ |
| Plan / Agent / YOLO modes | ✅ | ✅ |
| Permission prompts (once / always / deny) | ✅ | ✅ |
| **Tools** | | |
| Read · Write · Edit · Bash · Glob · Grep | ✅ | ✅ |
| WebFetch · WebSearch | ✅ | ✅ |
| apply\_patch | ✅ | ✅ |
| Multi-agent (Agent / SendMessage / Monitor) | ✅ | ✅ |
| Multimodal / image input | ❌ | ✅ |
| **Slash Commands** | | |
| `/help` · `/clear` · `/model` · `/mode` · `/cost` | ✅ | ✅ |
| `/resume` + per-project session persistence | ✅ | ✅ |
| `/compact` (context compression) | ✅ | ✅ |
| `/doctor` · `/init` · `/bug` | ✅ | ✅ |
| `/login` (browser OAuth / reverse proxy) | ✅ | ❌ |
| `/reasoning` effort tiers (off / high / max) | ✅ | ❌ |
| **Extensions** | | |
| MCP servers | ✅ | ✅ |
| Skills (slash commands loaded from `.md`) | ✅ | ✅ |
| Hooks (PreToolUse / PostToolUse / Stop / UserPromptSubmit) | ✅ | ✅ |
| **Auth & Distribution** | | |
| API key auth (`DEEPSEEK_API_KEY`) | ✅ | ✅ |
| Browser-session login proxy (ds2api-style) | ✅ | ❌ |
| `npm link` global install | ✅ | ✅ |
| IDE integration (VS Code / JetBrains) | ❌ | ✅ |
| One-line binary installer | 🔜 M5 | ✅ |
| **Advanced** | | |
| Memory system (project-level `CLAUDE.md`) | ❌ | ✅ |
| Background / scheduled agents | ❌ | ✅ |
| Git-aware operations (native git tool) | ❌ | ✅ |

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
