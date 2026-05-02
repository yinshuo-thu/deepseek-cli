import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { spawn } from 'node:child_process';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

import { Splash } from './ui/Splash.js';
import { MessageView } from './ui/Message.js';
import type { UIMessage } from './ui/Message.js';
import { StatusBar } from './ui/StatusBar.js';
import { type ActivityPhase, phaseFromTool } from './ui/statusVerbs.js';
import { PermissionPrompt } from './ui/Permission.js';
import { ResumePicker } from './ui/ResumePicker.js';
import { palette } from './ui/theme.js';
import { ExitPlanModePrompt } from './ui/ExitPlanMode.js';
import { DialogMcp } from './ui/DialogMcp.js';
import { DialogModel } from './ui/DialogModel.js';
import { bus } from './events/bus.js';
import { loadPersistedPermissions, persistPermission, clearPersistedPermissions } from './config/permissions.js';

import { DeepSeekClient } from './api/client.js';
import { runAgentLoop } from './agents/loop.js';
import { configureSpawn } from './agents/spawn.js';
import { dispatch as dispatchSlash, commandNames } from './commands/index.js';
import { Session, loadSession, type SessionMeta } from './session/history.js';
import { saveConfig, type Config, type ModelId, type PermissionMode, type ReasoningEffort, CONFIG_FILE } from './config/index.js';
import { loginFlow, logoutFlow, stopActiveProxy, whoamiFlow } from './commands/login.js';
import { listAgentsMarkdown, reloadAgentsMarkdown, writeAgentFile, defaultDraft } from './commands/agents.js';
import { listHooksMarkdown, reloadHooksMarkdown, trustHooksMarkdown } from './commands/hooks.js';
import { listSkillsMarkdown, reloadSkillsMarkdown, addSkillMarkdown } from './commands/skills.js';
import { listMcpMarkdown, initMcpMarkdown, addMcpMarkdown, enableMcpMarkdown, disableMcpMarkdown, reloadMcpMarkdown, removeMcpMarkdown } from './commands/mcp.js';
import { newInjectionState, pickSkillsToInject, formatInjectedSystem, markInjected, clearInjections } from './skills/inject.js';

const SYSTEM_PROMPT = `You are DeepSeek-CLI, a terminal-native coding agent powered by the DeepSeek V4 model family.

You operate inside the user's working directory and have access to four core tools — Read, Write, Edit, Bash — for inspecting and modifying files and running shell commands. Use them.

Conventions:
- Be concise. The user can read code; do not narrate it.
- Use markdown sparingly — headings only when it aids scanning.
- For file references in prose, write 'path/to/file.ts:42' so terminal users can click them.
- Prefer Edit over Write for existing files. Always Read before you Edit.
- Group independent tool calls in one turn when possible.
- Stop when the task is done; do not pad with summaries.

Code and technical output:
- Always wrap code in fenced code blocks with a language tag (e.g. \`\`\`typescript, \`\`\`sql). Code blocks are never optional.
- For TypeScript/JavaScript: include explicit type annotations on all parameters and return values. Use generics where appropriate. Handle edge cases (empty input, null, capacity boundaries).
- State time/space complexity (Big O) when non-obvious.

Math and quantitative reasoning:
- Show work step by step. Name the method used (substitution, complement rule, Euclid's proof, etc.).
- Include a concrete example or analogy. Give exact answers before approximations (e.g. "1 − (5/6)⁴ ≈ 0.518").

Debugging:
- Name the root cause precisely, show the corrected code in a fenced block, explain why the fix works. Never describe fixes in prose only.

Refactoring:
- Show before-code and after-code in separate fenced blocks when the original is provided.
- Name the pattern applied (guard clauses, extract function, SRP). State the concrete benefit.

Explanation and Q&A:
- Include: (1) plain-language definition, (2) concrete analogy or real-world example, (3) key terms defined before first use.
- Match depth to the audience level stated in the prompt. When comparing two things, address both sides explicitly.

Creative and enumeration:
- When the user asks for N items (5 names, 3 features), deliver exactly N — never fewer.
- For poetry, verify the form before responding (limerick = AABBA 5 lines; haiku = 5-7-5 syllables). Match humor/whimsy when the prompt signals it.

Analysis and comparison:
- Structure: (1) key tradeoff dimensions, (2) assessment of each option, (3) concrete recommendation with conditions. Every comparison must end with a recommendation.

Data and SQL:
- Write complete runnable SQL with realistic table/column names — no pseudocode placeholders.
- For regex: show the pattern in a code block, then explain each component. State known limitations.
- Include example input/output when writing data transformation code.

Working directory: {{CWD}}.`;

interface Props {
  config: Config;
  version: string;
  /** Pre-loaded recent sessions for the Splash pane. Forwarded as-is. */
  initialRecentSessions?: SessionMeta[];
}

interface PendingPermission {
  toolName: string;
  summary: string;
  resolve: (d: 'once' | 'always' | 'deny') => void;
}

export function App({ config: initialConfig, version, initialRecentSessions }: Props) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [config, setConfig] = useState<Config>(initialConfig);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<ActivityPhase | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [pendingPerm, setPendingPerm] = useState<PendingPermission | null>(null);
  const [pickingSession, setPickingSession] = useState(false);
  const [tokens, setTokens] = useState({ in: 0, out: 0, cost: 0 });
  const [, forceTick] = useState(0);
  const [exitPlanRequest, setExitPlanRequest] = useState<{ toolName: string; resolve: (a: 'exit-plan' | 'cancel') => void } | null>(null);
  const [showMcpDialog, setShowMcpDialog] = useState(false);
  const [showModelDialog, setShowModelDialog] = useState(false);
  const [vimMode, setVimMode] = useState(false);
  const sessionStartRef = useRef(Date.now());

  const sessionRef = useRef<Session>(new Session(process.cwd(), config.model));
  const skillStateRef = useRef(newInjectionState());
  const clientRef = useRef(new DeepSeekClient(config));
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<UIMessage[]>([]);
  messagesRef.current = messages;

  // Refresh client when config changes (model swap, etc.)
  useEffect(() => {
    clientRef.current = new DeepSeekClient(config);
    configureSpawn({ config, client: clientRef.current, cwd: process.cwd() });
  }, [config]);

  // Subscribe to ExitPlanModeRequest bus events.
  useEffect(() => {
    const unsub = bus.subscribe('ExitPlanModeRequest', (payload) => {
      setExitPlanRequest(payload);
    });
    return unsub;
  }, []);

  // Load persisted per-project permissions on startup.
  const persistedPermsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    loadPersistedPermissions(process.cwd()).then((perms) => {
      persistedPermsRef.current = perms;
    }).catch(() => {/* best-effort */});
  }, []);

  // Esc cancels stream; double Ctrl+C exits; Tab cycles modes; Shift+Tab cycles reasoning.
  const lastCtrlC = useRef(0);
  useInput((inp, key) => {
    if (key.escape && busy) {
      abortRef.current?.abort();
      return;
    }
    if (key.ctrl && inp === 'c') {
      const now = Date.now();
      if (busy) { abortRef.current?.abort(); return; }
      if (now - lastCtrlC.current < 1500) exit();
      else lastCtrlC.current = now;
      return;
    }
    // Tab cycles permission mode (only when input is empty so it doesn't
    // collide with shell-style completion behaviour).
    if (key.tab && !key.shift && input === '' && !busy) {
      const order: PermissionMode[] = ['plan', 'acceptEdits', 'agent', 'yolo'];
      const next = order[(order.indexOf(config.permissionMode) + 1) % order.length]!;
      saveConfig({ permissionMode: next })
        .then(setConfig)
        .catch((err) => pushMsg({
          id: `err-${Date.now()}`,
          role: 'system',
          content: `error: failed to save config — ${err instanceof Error ? err.message : String(err)}`,
        }));
      return;
    }
    if (key.tab && key.shift && input === '' && !busy) {
      const order: ReasoningEffort[] = ['off', 'high', 'max'];
      const next = order[(order.indexOf(config.reasoningEffort) + 1) % order.length]!;
      saveConfig({ reasoningEffort: next })
        .then(setConfig)
        .catch((err) => pushMsg({
          id: `err-${Date.now()}`,
          role: 'system',
          content: `error: failed to save config — ${err instanceof Error ? err.message : String(err)}`,
        }));
      return;
    }
  }, { isActive: !pendingPerm && !pickingSession && !exitPlanRequest && !showMcpDialog && !showModelDialog });

  const pushMsg = useCallback((m: UIMessage) => {
    setMessages((prev) => [...prev, m]);
  }, []);

  const updateLastAssistant = useCallback((delta: string, kind: 'assistant' | 'reasoning') => {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last && last.role === kind) {
        next[next.length - 1] = { ...last, content: last.content + delta };
        return next;
      }
      next.push({
        id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: kind,
        content: delta,
        pending: true,
      });
      return next;
    });
  }, []);

  const submit = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;

    // Slash commands.
    if (text.startsWith('/')) {
      const action = dispatchSlash(text, { config, cwd: process.cwd() });
      if (action) {
        setInput('');
        switch (action.type) {
          case 'message':
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: action.markdown });
            return;
          case 'clear':
            setMessages([]);
            sessionRef.current = new Session(process.cwd(), config.model);
            clearInjections(skillStateRef.current);
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: 'Conversation cleared.' });
            return;
          case 'exit':
            exit();
            return;
          case 'set-model': {
            const next = await saveConfig({ model: action.model });
            setConfig(next);
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: `Model set to **${action.model}**.` });
            return;
          }
          case 'set-mode': {
            const next = await saveConfig({ permissionMode: action.mode });
            setConfig(next);
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: `Mode → **${action.mode}**.` });
            return;
          }
          case 'set-reasoning': {
            const next = await saveConfig({ reasoningEffort: action.effort });
            setConfig(next);
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: `Reasoning effort → **${action.effort}**.` });
            return;
          }
          case 'open-config': {
            const editor = process.env.EDITOR || 'vi';
            await new Promise<void>((resolve) => {
              spawn(editor, [CONFIG_FILE], { stdio: 'inherit' }).on('exit', () => resolve());
            });
            return;
          }
          case 'show-cost': {
            pushMsg({
              id: `sys-${Date.now()}`,
              role: 'system',
              content: `Session: **${tokens.in}** in / **${tokens.out}** out tokens · est. cost **$${tokens.cost.toFixed(4)}**`,
            });
            return;
          }
          case 'resume-picker':
            setPickingSession(true);
            return;
          case 'compact':
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: '/compact is coming in M3.' });
            return;
          case 'auth-login': {
            // Fire-and-forget: server start is fast, but the browser
            // round-trip can take minutes. We surface progress via system
            // messages and never block the input box.
            (async () => {
              try {
                const result = await loginFlow({
                  onUrl: (url) => {
                    pushMsg({
                      id: `sys-${Date.now()}`,
                      role: 'system',
                      content: `auth server listening at ${url} — opening browser…`,
                    });
                  },
                });
                if (result.ok && result.proxyUrl) {
                  try {
                    const next = await saveConfig({
                      apiFlavor: 'deepseek-web',
                      baseUrl: result.proxyUrl,
                    });
                    setConfig(next);
                    clientRef.current = new DeepSeekClient(next);
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    pushMsg({
                      id: `err-${Date.now()}`,
                      role: 'system',
                      content: `error: failed to persist proxy config — ${msg}`,
                    });
                  }
                }
                pushMsg({
                  id: `sys-${Date.now()}`,
                  role: 'system',
                  content: result.ok ? result.message : `error: ${result.message}`,
                });
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                pushMsg({ id: `err-${Date.now()}`, role: 'system', content: `error: ${msg}` });
              }
            })();
            return;
          }
          case 'auth-logout': {
            stopActiveProxy();
            const r = await logoutFlow();
            try {
              const next = await saveConfig({
                apiFlavor: 'openai',
                baseUrl: 'https://api.deepseek.com',
              });
              setConfig(next);
              clientRef.current = new DeepSeekClient(next);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              pushMsg({
                id: `err-${Date.now()}`,
                role: 'system',
                content: `error: failed to restore openai flavor — ${msg}`,
              });
            }
            pushMsg({
              id: `sys-${Date.now()}`,
              role: 'system',
              content: r.ok ? r.message : `error: ${r.message}`,
            });
            return;
          }
          case 'auth-whoami': {
            const r = await whoamiFlow();
            pushMsg({
              id: `sys-${Date.now()}`,
              role: 'system',
              content: r.message,
            });
            return;
          }
          case 'agents-list': {
            const md = await listAgentsMarkdown(process.cwd());
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: md });
            return;
          }
          case 'agents-reload': {
            const md = await reloadAgentsMarkdown(process.cwd());
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: md });
            return;
          }
          case 'hooks-list': {
            const md = await listHooksMarkdown(process.cwd());
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: md });
            return;
          }
          case 'hooks-reload': {
            const md = await reloadHooksMarkdown(process.cwd());
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: md });
            return;
          }
          case 'hooks-trust': {
            const md = await trustHooksMarkdown(process.cwd());
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: md });
            return;
          }
          case 'skills-list': {
            const md = await listSkillsMarkdown(process.cwd());
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: md });
            return;
          }
          case 'skills-reload': {
            const md = await reloadSkillsMarkdown(process.cwd());
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: md });
            return;
          }
          case 'skills-add': {
            const md = await addSkillMarkdown(process.cwd(), action.name);
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: md });
            return;
          }
          case 'mcp-list': {
            const md = await listMcpMarkdown();
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: md });
            return;
          }
          case 'mcp-init': {
            const md = await initMcpMarkdown(process.cwd());
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: md });
            return;
          }
          case 'mcp-add': {
            const md = await addMcpMarkdown(process.cwd(), action.name, action.commandLine);
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: md });
            return;
          }
          case 'mcp-enable': {
            const md = await enableMcpMarkdown(process.cwd(), action.name);
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: md });
            return;
          }
          case 'mcp-disable': {
            const md = await disableMcpMarkdown(process.cwd(), action.name);
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: md });
            return;
          }
          case 'mcp-reload': {
            const md = await reloadMcpMarkdown();
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: md });
            return;
          }
          case 'mcp-remove': {
            const md = await removeMcpMarkdown(process.cwd(), action.name);
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: md });
            return;
          }
          case 'agents-create': {
            // Minimal flow: write a stub <name>.md the user can fill in.
            // The model-driven generator is left as future polish; we do not
            // call the API here to keep the slash command synchronous and
            // testable. Users can also create the file by hand.
            const name = `custom-${Date.now().toString(36)}`;
            try {
              const fp = await writeAgentFile(process.cwd(), defaultDraft(name, 'TODO: describe this agent.'));
              pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: `Created stub agent at \`${fp}\`. Edit it, then run \`/agents reload\`.` });
            } catch (e) {
              pushMsg({ id: `err-${Date.now()}`, role: 'system', content: `error: ${(e as Error).message}` });
            }
            return;
          }
          case 'mcp-dialog':
            setShowMcpDialog(true);
            return;
          case 'model-dialog':
            setShowModelDialog(true);
            return;
          case 'permissions-list': {
            const perms = Array.from(persistedPermsRef.current);
            const md = perms.length
              ? `**Persisted tool permissions (always-allow):**\n${perms.map((p) => `- \`${p}\``).join('\n')}`
              : 'No persisted tool permissions for this project.';
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: md });
            return;
          }
          case 'permissions-reset':
            persistedPermsRef.current = new Set();
            clearPersistedPermissions(process.cwd()).catch(() => {});
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: 'Persisted tool permissions cleared.' });
            return;
          case 'doctor': {
            const apiKeySet = !!(config.apiKey);
            const md = [
              '**DeepSeek-CLI Health Check**',
              '',
              '| Check | Value |',
              '|-------|-------|',
              `| Node.js version | \`${process.version}\` |`,
              `| Platform | \`${process.platform}\` |`,
              `| Config file | \`~/.deepseek/config.json\` |`,
              `| API key set | ${apiKeySet ? 'yes' : 'no'} |`,
              `| Model | \`${config.model}\` |`,
            ].join('\n');
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: md });
            return;
          }
          case 'init': {
            const deepseekMdPath = path.join(process.cwd(), 'DEEPSEEK.md');
            if (fs.existsSync(deepseekMdPath)) {
              pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: `**Warning:** \`DEEPSEEK.md\` already exists at \`${deepseekMdPath}\`.` });
            } else {
              const template = [
                '# Project Context',
                '',
                '## Overview',
                '<!-- Describe this project -->',
                '',
                '## Commands',
                '<!-- Key build/test/run commands -->',
                '',
                '## Architecture',
                '<!-- Key files and structure -->',
                '',
                '## Notes for AI',
                '<!-- Conventions, gotchas, preferences -->',
              ].join('\n');
              fs.writeFileSync(deepseekMdPath, template, 'utf8');
              pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: `Created \`DEEPSEEK.md\` at \`${deepseekMdPath}\`.` });
            }
            return;
          }
          case 'bug': {
            const md = [
              '**Report a Bug**',
              '',
              'Please open an issue at: <https://github.com/deepseek-cli/deepseek-cli/issues>',
              '',
              '**When filing a bug, include:**',
              '- Steps to reproduce',
              '- Expected vs actual behavior',
              '- Node.js version (`' + process.version + '`)',
              '- Platform (`' + process.platform + '`)',
              '- DeepSeek-CLI version',
            ].join('\n');
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: md });
            return;
          }
          case 'review': {
            let diff = '';
            try {
              diff = execSync('git diff HEAD', { encoding: 'utf8', cwd: process.cwd() });
            } catch {
              diff = '';
            }
            if (!diff.trim()) {
              pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: 'No uncommitted changes found.' });
              return;
            }
            // Inject as a user message so the AI handles it in the agent loop.
            setInput(`Please review the following git diff and provide feedback:\n\n\`\`\`diff\n${diff}\n\`\`\``);
            return;
          }
          case 'toggle-vim': {
            const next = !vimMode;
            setVimMode(next);
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: `Vim mode ${next ? 'enabled' : 'disabled'}.` });
            return;
          }
          case 'memory': {
            const deepseekMdPath = path.join(process.cwd(), 'DEEPSEEK.md');
            const notesMdPath = path.join(process.env.HOME ?? '~', '.deepseek', 'notes.md');
            if (fs.existsSync(deepseekMdPath)) {
              const content = fs.readFileSync(deepseekMdPath, 'utf8');
              pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: `**DEEPSEEK.md** (\`${deepseekMdPath}\`):\n\n${content}` });
            } else if (fs.existsSync(notesMdPath)) {
              const content = fs.readFileSync(notesMdPath, 'utf8');
              pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: `**~/.deepseek/notes.md**:\n\n${content}` });
            } else {
              pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: 'No memory file found. Run `/init` to create a `DEEPSEEK.md` project context file.' });
            }
            return;
          }
          case 'toggle-fast': {
            const nextModel: ModelId = config.model === 'deepseek-v4-flash' ? 'deepseek-v4-pro' : 'deepseek-v4-flash';
            const next = await saveConfig({ model: nextModel });
            setConfig(next);
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: `Fast mode: model switched to **${nextModel}**.` });
            return;
          }
          case 'upgrade': {
            const _require = createRequire(import.meta.url);
            const pkg = _require('../../package.json') as { version: string };
            pushMsg({
              id: `sys-${Date.now()}`,
              role: 'system',
              content: `**deepseek-cli** current version: \`${pkg.version}\`\n\nTo upgrade, run:\n\`\`\`\nnpm update -g deepseek-cli\n\`\`\``,
            });
            return;
          }
          case 'release-notes': {
            const md = [
              '**DeepSeek-CLI Release Notes**',
              '',
              '## v0.1.0 — Initial Release',
              '',
              '**M1:** Core TUI, streaming chat, slash command registry.',
              '**M2:** Agent loop with Read/Write/Edit/Bash tools, permission modes.',
              '**M3:** Session history, /resume, /compact placeholder.',
              '**M4:** MCP integration, /login web-session, skills injection, hooks system.',
            ].join('\n');
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: md });
            return;
          }
          case 'terminal-setup': {
            const md = [
              '**Shell Integration Setup**',
              '',
              '1. **Alias** — add to your `~/.zshrc` or `~/.bashrc`:',
              '   ```sh',
              '   alias ds="deepseek-cli"',
              '   ```',
              '',
              '2. **API Key** — set in your shell config:',
              '   ```sh',
              '   export DEEPSEEK_API_KEY="your-key-here"',
              '   ```',
              '',
              '3. **Shell completion** — coming soon. For now, tab-complete slash commands inside the TUI.',
            ].join('\n');
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: md });
            return;
          }
          case 'ide': {
            const md = [
              '**IDE Integration Status**',
              '',
              '| IDE | Status |',
              '|-----|--------|',
              '| Terminal (current) | Connected |',
              '| VSCode Extension | Coming soon |',
              '| JetBrains Plugin | Planned |',
              '',
              'Run `deepseek-cli` (or `ds`) directly in your IDE\'s integrated terminal.',
            ].join('\n');
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: md });
            return;
          }
          case 'status': {
            const apiSource = process.env.DEEPSEEK_API_KEY
              ? 'env (DEEPSEEK_API_KEY)'
              : config.apiKey
                ? 'config file'
                : config.apiFlavor === 'deepseek-web'
                  ? 'web-session'
                  : 'not set';
            const started = new Date(sessionStartRef.current).toISOString();
            const md = [
              '**DeepSeek-CLI Status**',
              '',
              '| Field | Value |',
              '|-------|-------|',
              `| Auth | ${apiSource} |`,
              `| Model | \`${config.model}\` |`,
              `| Mode | \`${config.permissionMode}\` |`,
              `| Reasoning | \`${config.reasoningEffort}\` |`,
              `| Session started | ${started} |`,
            ].join('\n');
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: md });
            return;
          }
          case 'noop':
            if (action.message) pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: action.message });
            return;
        }
      }
    }

    // Normal user prompt → kick the agent loop.
    setInput('');
    pushMsg({ id: `u-${Date.now()}`, role: 'user', content: text });

    const sysMsg = SYSTEM_PROMPT.replace('{{CWD}}', process.cwd());
    const session = sessionRef.current;
    await session.append({ role: 'user', content: text });
    const apiMsgs = [{ role: 'system' as const, content: sysMsg }, ...session.messages()];

    // Match skills against this prompt and prepare injected system messages.
    let injectedSystemMessages: { role: 'system'; content: string }[] | undefined;
    try {
      const recent = session.messages().filter((m) => typeof m.content === 'string').slice(-4).map((m) => String(m.content));
      const picked = await pickSkillsToInject({ cwd: process.cwd(), prompt: text, recent, state: skillStateRef.current });
      if (picked.length) {
        injectedSystemMessages = picked.map((d) => ({ role: 'system' as const, content: formatInjectedSystem(d).content as string }));
        for (const d of picked) markInjected(skillStateRef.current, d.name);
        pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: `Skills injected: ${picked.map((d) => d.name).join(', ')}` });
      }
    } catch (err) {
      pushMsg({ id: `err-${Date.now()}`, role: 'system', content: `skill match failed: ${(err as Error).message}` });
    }

    setBusy(true);
    setActivity(config.reasoningEffort === 'max' ? 'reasoning' : 'thinking');
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // Reasoning=max forces deepseek-reasoner; otherwise use the configured chat model.
    const effectiveModel = config.reasoningEffort === 'max' ? 'deepseek-reasoner' : config.model;

    try {
      await runAgentLoop({
        client: clientRef.current,
        messages: apiMsgs,
        cwd: process.cwd(),
        model: effectiveModel,
        mode: config.permissionMode,
        signal: ctrl.signal,
        ...(injectedSystemMessages ? { injectedSystemMessages } : {}),
        cb: {
          onAssistantDelta: (d) => updateLastAssistant(d, 'assistant'),
          onReasoningDelta: (d) => updateLastAssistant(d, 'reasoning'),
          onToolCallStart: (id, name) => {
            pushMsg({ id, role: 'tool', toolName: name, content: '', toolStatus: 'pending', pending: true });
            setActivity(phaseFromTool(name));
          },
          onToolCallArgs: () => {/* args streamed; no-op for now */},
          onToolCallReady: (id, _name, args) => {
            setMessages((prev) => prev.map((m) => m.id === id ? { ...m, content: previewArgs(args) } : m));
          },
          onToolResult: (id, _name, ok, summary) => {
            setMessages((prev) => prev.map((m) => m.id === id ? { ...m, toolStatus: ok ? 'ok' : 'err', pending: false, content: summary } : m));
            setActivity('thinking'); // back to thinking after tool completes
          },
          onTurnEnd: () => {/* fall through */},
          onUsage: (in_, out, cost) => setTokens({ in: in_, out, cost }),
          onError: (msg) => pushMsg({ id: `err-${Date.now()}`, role: 'system', content: `error: ${msg}` }),
          requestPermission: (toolName, summary) => {
            if (persistedPermsRef.current.has(toolName)) return Promise.resolve('once' as const);
            return new Promise((resolve) => {
              setPendingPerm({
                toolName,
                summary,
                resolve: (d) => {
                  if (d === 'always') {
                    persistedPermsRef.current.add(toolName);
                    persistPermission(process.cwd(), toolName).catch(() => {/* best-effort */});
                  }
                  resolve(d);
                },
              });
            });
          },
          log: (line) => forceTick((n) => n + 1),
        },
      });

      // Sync new messages back into Session for persistence.
      // apiMsgs layout going into the loop: [system, ...session.messages()].
      // The agent loop mutates apiMsgs by appending the assistant reply, any
      // tool calls, and tool results. We skip:
      //   - index 0          (system message — never persisted)
      //   - indices 1..N     (already in `session.messages()` from before the loop)
      // and persist everything appended by the loop after that.
      const newApi = apiMsgs.slice(1 + session.messages().length);
      for (const m of newApi) await session.append(m);

      // Mark trailing pending messages as not pending.
      setMessages((prev) => prev.map((m) => m.pending ? { ...m, pending: false } : m));
    } finally {
      setBusy(false);
      setActivity(null);
      abortRef.current = null;
    }
  }, [busy, config, exit, pushMsg, tokens, updateLastAssistant]);

  // Suggest commands when user types '/' followed by partial.
  const suggestions = useMemo(() => {
    if (!input.startsWith('/') || input.includes(' ')) return [];
    const q = input.toLowerCase();
    return commandNames().filter((n) => n.startsWith(q)).slice(0, 6);
  }, [input]);

  const termCols = stdout?.columns ?? 80;

  return (
    <Box flexDirection="column" paddingX={1}>
      {messages.length === 0 && (
        <Splash
          version={version}
          model={config.model}
          cwd={process.cwd()}
          termCols={termCols}
          initialRecent={initialRecentSessions}
        />
      )}

      {messages.map((m) => <MessageView key={m.id} msg={m} />)}

      {pendingPerm && (
        <PermissionPrompt
          toolName={pendingPerm.toolName}
          summary={pendingPerm.summary}
          onResolve={(d) => {
            const { resolve } = pendingPerm;
            setPendingPerm(null);
            resolve(d);
          }}
        />
      )}

      {pickingSession && (
        <ResumePicker
          cwd={process.cwd()}
          onPick={async (id) => {
            setPickingSession(false);
            if (!id) return;
            const loaded = await loadSession(process.cwd(), id);
            if (!loaded) {
              pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: 'failed to load session.' });
              return;
            }
            // Replace the in-memory Session and rehydrate UI from the persisted log.
            const s = new Session(process.cwd(), config.model);
            for (const m of loaded.messages) await s.append(m);
            sessionRef.current = s;
            const uiMsgs: UIMessage[] = loaded.messages
              .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content))
              .map((m, i) => ({
                id: `r-${i}-${Date.now()}`,
                role: m.role as 'user' | 'assistant',
                content: typeof m.content === 'string' ? m.content : '',
              }));
            setMessages([
              { id: `sys-${Date.now()}`, role: 'system', content: `Resumed session **${id}** (${loaded.messages.length} messages).` },
              ...uiMsgs,
            ]);
          }}
        />
      )}

      {exitPlanRequest && (
        <ExitPlanModePrompt
          toolName={exitPlanRequest.toolName}
          onResolve={(action) => {
            const { resolve } = exitPlanRequest;
            setExitPlanRequest(null);
            if (action === 'exit-plan') {
              saveConfig({ permissionMode: 'agent' })
                .then((next) => { setConfig(next); resolve(action); })
                .catch(() => resolve(action)); // still resolve on error so loop isn't stuck
            } else {
              resolve(action);
            }
          }}
        />
      )}

      {showMcpDialog && (
        <DialogMcp
          servers={[]}
          onToggle={() => {}}
          onClose={() => setShowMcpDialog(false)}
        />
      )}

      {showModelDialog && (
        <DialogModel
          currentModel={config.model}
          onSelect={async (model) => {
            setShowModelDialog(false);
            const next = await saveConfig({ model: model as any });
            setConfig(next);
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: `Model set to **${model}**.` });
          }}
          onClose={() => setShowModelDialog(false)}
        />
      )}

      {!pendingPerm && !pickingSession && (
        <Box marginTop={1}>
          <Text color={palette.deepseekBlue}>{busy ? '⋯ ' : '› '}</Text>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={submit}
            placeholder={busy ? 'streaming — Esc to cancel' : 'ask DeepSeek anything (/help for commands)'}
            showCursor={!busy}
          />
        </Box>
      )}

      {suggestions.length > 0 && (
        <Box marginLeft={2}>
          <Text color={palette.fgMuted}>{suggestions.join('  ')}</Text>
        </Box>
      )}

      <StatusBar
        model={config.reasoningEffort === 'max' ? 'deepseek-reasoner' : config.model}
        cwd={process.cwd()}
        inputTokens={tokens.in}
        outputTokens={tokens.out}
        costUSD={tokens.cost}
        busy={busy}
        activity={activity}
        mode={config.permissionMode}
        reasoningEffort={config.reasoningEffort}
        termCols={termCols}
      />
    </Box>
  );
}

function previewArgs(args: any): string {
  if (!args || typeof args !== 'object') return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    const repr = typeof v === 'string' ? (v.length > 80 ? v.slice(0, 80) + '…' : v) : JSON.stringify(v);
    parts.push(`${k}=${repr}`);
    if (parts.join('  ').length > 120) break;
  }
  return parts.join('  ');
}
