import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { spawn } from 'node:child_process';

import { Splash } from './ui/Splash.js';
import { MessageView } from './ui/Message.js';
import type { UIMessage } from './ui/Message.js';
import { StatusBar } from './ui/StatusBar.js';
import { PermissionPrompt } from './ui/Permission.js';
import { palette } from './ui/theme.js';

import { DeepSeekClient } from './api/client.js';
import { runAgentLoop } from './agents/loop.js';
import { dispatch as dispatchSlash, commandNames } from './commands/index.js';
import { Session } from './session/history.js';
import { saveConfig, type Config, type ModelId, CONFIG_FILE } from './config/index.js';

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
}

interface PendingPermission {
  toolName: string;
  summary: string;
  resolve: (d: 'once' | 'always' | 'deny') => void;
}

export function App({ config: initialConfig, version }: Props) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [config, setConfig] = useState<Config>(initialConfig);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [pendingPerm, setPendingPerm] = useState<PendingPermission | null>(null);
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
  }, [config]);

  // Esc cancels an in-flight stream; double Ctrl+C exits.
  const lastCtrlC = useRef(0);
  useInput((inp, key) => {
    if (key.escape && busy) {
      abortRef.current?.abort();
    }
    if (key.ctrl && inp === 'c') {
      const now = Date.now();
      if (busy) {
        abortRef.current?.abort();
        return;
      }
      if (now - lastCtrlC.current < 1500) exit();
      else lastCtrlC.current = now;
    }
  }, { isActive: !pendingPerm });

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
          case 'open-config': {
            const editor = process.env.EDITOR || 'vi';
            spawn(editor, [CONFIG_FILE], { stdio: 'inherit' });
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
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: '/resume picker is coming in M3.' });
            return;
          case 'compact':
            pushMsg({ id: `sys-${Date.now()}`, role: 'system', content: '/compact is coming in M3.' });
            return;
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

    try {
      await runAgentLoop({
        client: clientRef.current,
        messages: apiMsgs,
        cwd: process.cwd(),
        model: config.model,
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

      // Sync new messages back into Session for persistence (skip system msg at idx 0).
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

  return (
    <Box flexDirection="column" paddingX={1}>
      {messages.length === 0 && <Splash version={version} model={config.model} cwd={process.cwd()} />}

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

      {!pendingPerm && (
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
        model={config.model}
        cwd={process.cwd()}
        inputTokens={tokens.in}
        outputTokens={tokens.out}
        costUSD={tokens.cost}
        busy={busy}
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
