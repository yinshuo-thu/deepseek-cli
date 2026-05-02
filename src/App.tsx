import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { spawn } from 'node:child_process';

import { Splash } from './ui/Splash.js';
import { MessageView } from './ui/Message.js';
import type { UIMessage } from './ui/Message.js';
import { StatusBar } from './ui/StatusBar.js';
import { PermissionPrompt } from './ui/Permission.js';
import { ResumePicker } from './ui/ResumePicker.js';
import { palette } from './ui/theme.js';

import { DeepSeekClient } from './api/client.js';
import { runAgentLoop } from './agents/loop.js';
import { configureSpawn } from './agents/spawn.js';
import { dispatch as dispatchSlash, commandNames } from './commands/index.js';
import { Session, loadSession, type SessionMeta } from './session/history.js';
import { saveConfig, type Config, type ModelId, type PermissionMode, type ReasoningEffort, CONFIG_FILE } from './config/index.js';
import { loginFlow, logoutFlow, stopActiveProxy, whoamiFlow } from './commands/login.js';
import { listAgentsMarkdown, reloadAgentsMarkdown, writeAgentFile, defaultDraft } from './commands/agents.js';

const SYSTEM_PROMPT = `You are DeepSeek-CLI, a terminal-native coding agent powered by the DeepSeek V4 model family.

You operate inside the user's working directory and have access to four core tools — Read, Write, Edit, Bash — for inspecting and modifying files and running shell commands. Use them.

Conventions:
- Be concise. The user can read code; do not narrate it.
- Use markdown sparingly — headings only when it aids scanning.
- For file references in prose, write 'path/to/file.ts:42' so terminal users can click them.
- Prefer Edit over Write for existing files. Always Read before you Edit.
- Group independent tool calls in one turn when possible.
- Stop when the task is done; do not pad with summaries.

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
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [pendingPerm, setPendingPerm] = useState<PendingPermission | null>(null);
  const [pickingSession, setPickingSession] = useState(false);
  const [tokens, setTokens] = useState({ in: 0, out: 0, cost: 0 });
  const [, forceTick] = useState(0);

  const sessionRef = useRef<Session>(new Session(process.cwd(), config.model));
  const clientRef = useRef(new DeepSeekClient(config));
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<UIMessage[]>([]);
  messagesRef.current = messages;

  // Refresh client when config changes (model swap, etc.)
  useEffect(() => {
    clientRef.current = new DeepSeekClient(config);
    configureSpawn({ config, client: clientRef.current, cwd: process.cwd() });
  }, [config]);

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
      const order: PermissionMode[] = ['plan', 'agent', 'yolo'];
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
  }, { isActive: !pendingPerm && !pickingSession });

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

    setBusy(true);
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
        cb: {
          onAssistantDelta: (d) => updateLastAssistant(d, 'assistant'),
          onReasoningDelta: (d) => updateLastAssistant(d, 'reasoning'),
          onToolCallStart: (id, name) => {
            pushMsg({ id, role: 'tool', toolName: name, content: '', toolStatus: 'pending', pending: true });
          },
          onToolCallArgs: () => {/* args streamed; no-op for now */},
          onToolCallReady: (id, _name, args) => {
            setMessages((prev) => prev.map((m) => m.id === id ? { ...m, content: previewArgs(args) } : m));
          },
          onToolResult: (id, _name, ok, summary) => {
            setMessages((prev) => prev.map((m) => m.id === id ? { ...m, toolStatus: ok ? 'ok' : 'err', pending: false, content: summary } : m));
          },
          onTurnEnd: () => {/* fall through */},
          onUsage: (in_, out, cost) => setTokens({ in: in_, out, cost }),
          onError: (msg) => pushMsg({ id: `err-${Date.now()}`, role: 'system', content: `error: ${msg}` }),
          requestPermission: (toolName, summary) =>
            new Promise((resolve) => setPendingPerm({ toolName, summary, resolve })),
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
