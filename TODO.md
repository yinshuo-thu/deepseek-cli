# DeepSeek-CLI — Implementation TODO

> Living document. Each milestone has detailed sub-tasks. Tick them as they ship.
> Convention: `[ ]` = pending · `[~]` = in progress · `[x]` = done · `[!]` = blocked
> Goal: feature-parity with Anthropic's Claude Code CLI, surfaced over the DeepSeek V4 model family.

Last updated: 2026-05-02

---

## M1 — Working CLI MVP (target: today)

**Acceptance criteria:** `npm run dev` opens a TUI with the DeepSeek whale splash, takes a prompt, streams a response from `deepseek-v4-flash`, and can call the four core tools (Read/Write/Edit/Bash) end-to-end. `/help`, `/clear`, `/model`, `/exit` work. Config persists at `~/.deepseek/config.json`.

### Project scaffold
- [x] `package.json` with bin `deepseek` / `ds`
- [x] `tsconfig.json` (ES2022, JSX, strict)
- [x] `.gitignore`
- [x] `bin/deepseek.js` (dev↔dist auto-switch shim)
- [x] Source directory layout (`src/{api,tools,commands,ui,config,session,utils,agents}`)
- [x] `npm install` succeeds, `npm run typecheck` clean

### Config & first-run
- [x] `~/.deepseek/config.json` schema (apiKey, baseUrl, model, theme, telemetry, apiFlavor)
- [x] First-run wizard: prompts for API key
- [x] `DEEPSEEK_API_KEY` env var override
- [x] `--api-key` / `--base-url` / `--model` CLI flags
- [x] API-key redacted in default logs (`redact()` helper)
- [ ] Validate key with a 1-token ping during wizard

### DeepSeek API client
- [x] OpenAI-compatible streaming client (`POST /chat/completions`, SSE)
- [x] Tool-call (function-calling) request/response shapes
- [x] Token-usage extraction + cost calculation (v4-flash & v4-pro pricing)
- [x] Cancellation via `AbortController` (Ctrl-C / Esc)
- [ ] Anthropic-compatible client (`POST /anthropic/v1/messages`) — fallback path
- [ ] Request retry w/ exponential backoff on 429/5xx

### TUI (Ink + React)
- [x] Splash screen — DeepSeek whale ASCII art, version, model
- [x] Bottom input box (`>`-prompt, Ctrl-C cancel)
- [x] Streaming message bubble — assistant tokens render as they arrive
- [x] Markdown renderer (headings, lists, **bold**, *italic*, `inline`)
- [x] Syntax-highlighted code blocks (`cli-highlight`)
- [x] Tool-call cards — pending / ok / err glyphs + arg preview
- [x] Status bar — model, cwd, tokens-used, est. cost
- [x] Theme system w/ DeepSeek-blue palette
- [x] Spinner during reasoning + tool calls
- [ ] Multi-line input on Shift-Enter
- [ ] Light theme variant
- [ ] Resize-aware reflow

### Tools
- [x] `Read` — read file (line range)
- [x] `Write` — write file (must read first if exists)
- [x] `Edit` — exact-string replacement (unique-match guard)
- [x] `Bash` — exec with stream + 2-min timeout default
- [x] `Glob` — glob match with mtime sort
- [x] `Grep` — ripgrep w/ JS fallback
- [x] `list_dir` — gitignore-aware structured listing
- [x] `apply_patch` — atomic multi-file unified-diff apply
- [x] `WebFetch` — http GET with HTML→text
- [x] `WebSearch` — DuckDuckGo HTML scrape
- [x] Permission prompt (allow once / always / deny)
- [x] Plan / Agent / YOLO mode tool gating (toolsForMode)
- [ ] Permission persistence per project (`~/.deepseek/projects/<hash>/permissions.json`)
- [ ] Image read in `Read` tool

### Modes & reasoning
- [x] Permission modes: `plan` / `agent` / `yolo` (Claude-Code-style)
- [x] `Tab` cycles modes when input is empty
- [x] `Shift+Tab` cycles reasoning effort `off → high → max`
- [x] Reasoning=max auto-switches model to `deepseek-reasoner`
- [x] Status bar shows current mode + effort
- [x] `/mode plan|agent|yolo` and `/reasoning off|high|max` slash commands

### Slash commands
- [x] `/help` — list commands
- [x] `/clear` — clear conversation
- [x] `/model` — switch model
- [x] `/exit` `/quit` — graceful shutdown
- [x] `/config` — open config in $EDITOR
- [x] `/cost` — show session cost breakdown
- [x] `/cwd` — show working directory
- [x] `/resume` — interactive session picker
- [ ] `/compact` — summarise + truncate when context fills (M3)

### Conversation history
- [x] In-memory message log
- [x] Persistence to `~/.deepseek/projects/<cwd-hash>/sessions/<id>.jsonl`
- [x] `/resume` picker (most recent 15 sessions)
- [x] Per-session meta JSON (firstUserPrompt, message count, timestamps)
- [ ] `/compact` summarisation (M3)

### Distribution (M1 part — full distro is M5)
- [x] `README.md` — install, quickstart, model table, comparison matrix
- [x] `install.sh` (npm-based; binary fallback is M5)
- [x] `LICENSE` (MIT)
- [x] First push to `github.com/yinshuo-thu/deepseek-cli`

---

## M2 — Reverse-proxy auth (ds2api-style)

**Acceptance:** running `deepseek login` opens a browser to a local authorize page, the user pastes their DeepSeek web session cookie, and subsequent CLI calls are proxied through a local Go (or Node) reverse proxy that converts requests to DeepSeek's web protocol. CLI is unaware whether it's talking to the official API or the proxy.

- [ ] Spike: study `refs/ds2api/internal/` to map web-session ↔ OpenAI-format conversion
- [ ] Local proxy server (Node, port `auto`, falls back to `127.0.0.1:31337`)
- [ ] `deepseek login` opens authorize page (HTML mirrors `authorize.png`)
- [ ] OAuth-style PKCE-like flow (token round-trip via localhost)
- [ ] Cookie/JWT storage in OS keychain (`keytar`)
- [ ] `deepseek logout` revokes + deletes
- [ ] Detect 401/expiry and prompt re-login transparently
- [ ] Switch between API-key mode and proxy mode in `/config`

---

## M3 — Subagents & multi-agent coordination

**Acceptance:** main session can spawn `dev`, `eval`, `plan`, `sum`, `github` subagents (per the design diagrams supplied). Each subagent has its own context, tools, model. Main agent can resume a subagent (`SendMessage(agent_id)`-style). Agent IDs persist on disk so a parent can re-attach across runs.

- [ ] Subagent definition format (`.deepseek/agents/<name>.md` with frontmatter — match Claude Code's format exactly)
- [ ] Frontmatter fields: `name`, `description`, `tools`, `model`, `permissionMode`, `skills`
- [ ] Spawn API: `Agent(subagent_type, prompt) → agent_id`
- [ ] Resume API: `SendMessage(agent_id, prompt)`
- [ ] Agent metadata at `~/.deepseek/projects/<hash>/agent-<id>.meta.json`
- [ ] Built-in agents: `general-purpose`, `Explore`, `Plan`, `dev`, `eval`, `sum`, `github`
- [ ] Parallel agent execution (multiple `Agent(...)` in one model turn)
- [ ] Background agents (`run_in_background`) + `Monitor`
- [ ] Worktree isolation (`isolation: "worktree"`) via git worktree

---

## M4 — MCP, Skills, Hooks, Permission modes

- [ ] **MCP client** — connect to MCP servers over stdio + SSE; mount their tools
- [ ] `mcp.json` discovery (project + user scope)
- [ ] **Skills** — `.deepseek/skills/<name>/SKILL.md`; auto-load on trigger
- [ ] Skill invocation tool (`Skill(name, args)`)
- [ ] **Hooks** — `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop` events
- [ ] Hook config in `settings.json`; matchers + commands
- [ ] **Permission modes** — `default`, `acceptEdits`, `plan`, `bypassPermissions`
- [ ] Plan mode renders an `ExitPlanMode` confirmation
- [ ] Settings hierarchy: enterprise → user → project → local

---

## M5 — Distribution & polish

- [ ] `pkg`/`bun build --compile` single-binary builds for darwin-arm64, darwin-x64, linux-x64, win-x64
- [ ] `install.sh` downloads correct binary from GitHub Releases
- [ ] `npm i -g @yinshuo-thu/deepseek-cli`
- [ ] Homebrew tap (`brew install yinshuo-thu/tap/deepseek`)
- [ ] VSCode extension stub (registers `deepseek.startCli` command)
- [ ] Terminal app icon swap (whale `.icns`/`.ico` for macOS Terminal & iTerm2 profiles)
- [ ] CI: GitHub Actions — lint, typecheck, smoke test on each PR
- [ ] Release-please automation
- [ ] Documentation site (`docs/`)

---

## Commands parity matrix (Claude Code → DeepSeek-CLI)

| Claude Code | DeepSeek-CLI | Status |
|-------------|--------------|--------|
| `/help`     | `/help`      | M1 |
| `/clear`    | `/clear`     | M1 |
| `/model`    | `/model`     | M1 |
| `/cost`     | `/cost`      | M1 |
| `/config`   | `/config`    | M1 |
| `/resume`   | `/resume`    | M1 |
| `/compact`  | `/compact`   | M1 |
| `/init`     | `/init`      | M3 |
| `/review`   | `/review`    | M3 |
| `/agents`   | `/agents`    | M3 |
| `/mcp`      | `/mcp`       | M4 |
| `/hooks`    | `/hooks`     | M4 |
| `/permissions` | `/permissions` | M4 |
| `/login`    | `/login`     | M2 |
| `/logout`   | `/logout`    | M2 |
| `/doctor`   | `/doctor`    | M5 |
| `/upgrade`  | `/upgrade`   | M5 |
| `/bug`      | `/bug`       | M5 |

---

## Tools parity matrix

| Claude Code | DeepSeek-CLI | Status |
|-------------|--------------|--------|
| Read        | Read         | M1 |
| Write       | Write        | M1 |
| Edit        | Edit         | M1 |
| Bash        | Bash         | M1 |
| Glob        | Glob         | M1 |
| Grep        | Grep         | M1 |
| WebFetch    | WebFetch     | M2 |
| WebSearch   | WebSearch    | M2 |
| Agent       | Agent        | M3 |
| TodoWrite   | TodoWrite    | M3 |
| NotebookEdit| NotebookEdit | M4 |
| Skill       | Skill        | M4 |
| Monitor     | Monitor      | M3 |
| TaskOutput  | TaskOutput   | M3 |
| TaskStop    | TaskStop     | M3 |

---

## Out of scope (intentionally)

- Cloud agents / "Claude.ai" web equivalent (no infra to host)
- Anthropic-managed billing, support, telemetry
- Closed-source Claude features that aren't in the public CLI
