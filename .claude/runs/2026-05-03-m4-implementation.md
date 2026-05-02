Date: 2026-05-03 00:00 UTC

## TL;DR

- M4 milestone fully shipped: permission modes, plan-mode dialog, settings hierarchy, MCP enterprise scope, event bus, and three new UI dialogs.
- Multi-agent pipeline (Plan→Dev×3 parallel→Eval→Fix→Summary) produced all 6 new files and 7 modified files in a single session.
- All M4 checklist items are now [x]; M5 distribution work is next.

---

## What was built

- Typed event bus (`ExitPlanModeRequest`, `McpStatusChanged`, `PermissionPersisted`) decoupling agent loop from UI layer.
- 4-layer settings hierarchy loader: enterprise → user → project → local, with deep-merge semantics.
- Per-project permission persistence: always-allowed tools stored at `~/.deepseek/projects/<hash>/permissions.json`.
- `ExitPlanMode` Ink dialog: shown when a write-category tool is invoked while in plan mode; user confirms to exit plan mode and proceed.
- `DialogMcp` interactive dialog: space-bar toggles MCP servers enabled/disabled.
- `DialogModel` dialog: arrow-key navigation over available model list.
- `PermissionMode` extended with `acceptEdits` (Write+Edit, no Bash) and `default` variants; `toolsForMode` updated to gate accordingly.
- Enterprise MCP scope added to `mcp/config.ts` (3-layer: enterprise→user→project).
- Agent loop emits `ExitPlanModeRequest` when plan-mode encounters a write tool; mode mutation affects current turn.
- `App.tsx` wires bus subscriptions, renders new dialogs, loads persisted permissions, Tab cycle includes `acceptEdits`.
- New slash commands: `/mcp-ui`, `/model-ui`, `/permissions [reset]`.
- `StatusBar` updated with display labels for `acceptEdits` and `default` modes.

---

## Files created

| File | Purpose |
|------|---------|
| `src/events/bus.ts` | Typed EventEmitter bus |
| `src/config/settings.ts` | 4-layer settings hierarchy loader |
| `src/config/permissions.ts` | Per-project permission persistence |
| `src/ui/ExitPlanMode.tsx` | Plan-mode write-tool confirmation dialog |
| `src/ui/DialogMcp.tsx` | MCP server toggle dialog |
| `src/ui/DialogModel.tsx` | Model picker dialog |

## Files modified

| File | Change |
|------|--------|
| `src/config/index.ts` | `PermissionMode` extended with `acceptEdits`, `default` |
| `src/tools/index.ts` | `toolsForMode` handles `acceptEdits` |
| `src/mcp/config.ts` | Enterprise MCP scope (3-layer) |
| `src/agents/loop.ts` | Emits `ExitPlanModeRequest`; mutable mode |
| `src/App.tsx` | Bus subscriptions, dialog rendering, persisted perms, Tab cycle |
| `src/commands/index.ts` | `/mcp-ui`, `/model-ui`, `/permissions [reset]` |
| `src/ui/StatusBar.tsx` | `acceptEdits` and `default` display labels |

---

## Multi-agent collaboration pattern

Pipeline: Plan → Dev×3 (parallel) → Eval → Fix → Summary

- **Plan agent** produced a structured task breakdown for M4 features.
- **Three Dev agents ran in parallel**, each owning a subset of files (bus+settings, UI dialogs, loop+App wiring).
- **Eval agent** reviewed output for type correctness, hook wiring, and dialog accessibility.
- **Fix agent** addressed evaluation findings (mode mutability in loop, Tab cycle gap).
- **Summary agent** (this run) ticked TODO.md and wrote this record.

External reference: `opencode` repo (https://github.com/sst/opencode) was cloned, studied for TUI dialog patterns and bus architecture, then deleted after feature extraction.

---

## Key decisions

- Event bus (not direct callback refs) chosen to avoid circular imports between `agents/loop.ts` and `App.tsx`.
- `acceptEdits` mode gates Write+Edit but excludes Bash, matching Claude Code's intermediate permission tier exactly.
- Settings hierarchy uses deep-merge (later layers override earlier); enterprise layer is read-only to the user.
- Per-project permissions keyed by cwd hash, consistent with existing session storage convention.
- `ExitPlanMode` dialog triggers in-turn mode mutation so the pending write tool executes immediately after confirmation, avoiding a round-trip.

---

## What is deferred / next

- M5: single-binary distribution (pkg/bun), Homebrew tap, CI, docs site.
- Owning agent for next move: **Distribution/DevOps agent** (M5 kick-off).
