// The agent loop: stream → accumulate tool calls → run tools → loop until plain reply.
//
// Owned by App.tsx via a callbacks bag. We emit fine-grained events so the UI
// can render tokens as they arrive, show tool cards, and request permissions.

import type { ChatMessage, ToolDefinition } from '../api/types.js';
import { DeepSeekClient, estimateCostUSD } from '../api/client.js';
import { toolsForMode, toolByName, markRead } from '../tools/index.js';
import type { Tool, ToolContext, AgentRuntime } from '../tools/types.js';
import type { PermissionMode } from '../config/index.js';
import { runHooks } from '../hooks/runner.js';
import { bus } from '../events/bus.js';

// Tools that require exiting plan mode before they can run.
const PLAN_BLOCKED_TOOLS = new Set(['Write', 'Edit', 'Bash', 'apply_patch', 'ApplyPatch']);

export interface LoopCallbacks {
  onAssistantDelta: (delta: string) => void;
  onReasoningDelta: (delta: string) => void;
  onToolCallStart: (id: string, name: string) => void;
  onToolCallArgs: (id: string, partialJson: string) => void;
  onToolCallReady: (id: string, name: string, args: any) => void;
  onToolResult: (id: string, name: string, ok: boolean, summary: string) => void;
  onTurnEnd: (finishReason: string) => void;
  onUsage: (in_: number, out: number, cost: number) => void;
  onError: (msg: string) => void;
  requestPermission: (tool: string, summary: string) => Promise<'once' | 'always' | 'deny'>;
  log: (line: string) => void;
}

interface PendingToolCall {
  id: string;
  index: number;
  name: string;
  argsBuf: string;
}

export async function runAgentLoop(args: {
  client: DeepSeekClient;
  messages: ChatMessage[];          // mutated — caller persists after each turn
  cwd: string;
  model: string;
  signal: AbortSignal;
  cb: LoopCallbacks;
  mode: PermissionMode;
  maxTurns?: number;
  /** Subset of tools available to this loop; defaults to mode-filter over ALL_TOOLS. */
  availableTools?: Tool[];
  /** Optional system messages injected (prepended) at the start of the first turn — typically skill bodies. */
  injectedSystemMessages?: ChatMessage[];
  /** Optional fields for subagent runs. */
  agentId?: string;
  parentId?: string;
  depth?: number;
  agentRuntime?: AgentRuntime;
  /** Called after every appended message — used for per-message JSONL flushing. */
  onMessageAppended?: (msg: ChatMessage) => void | Promise<void>;
}): Promise<void> {
  const { client, messages, cwd, model, signal, cb } = args;
  let mode = args.mode; // mutable — updated when user exits plan mode
  const maxTurns = args.maxTurns ?? 25;
  const persistentlyAllowed = new Set<string>(); // tools allowed for the rest of the turn-chain
  const readFiles = new Set<string>();

  const ctx: ToolContext = {
    cwd,
    log: cb.log,
    readFiles,
    agentId: args.agentId,
    parentId: args.parentId,
    depth: args.depth ?? 0,
    agentRuntime: args.agentRuntime,
    signal,
    async requestPermission(tool, summary) {
      if (mode === 'yolo') return 'once';                         // yolo: never ask
      if (persistentlyAllowed.has(tool)) return 'once';
      const decision = await cb.requestPermission(tool, summary);
      if (decision === 'always') persistentlyAllowed.add(tool);
      return decision;
    },
  };

  const flush = async (m: ChatMessage) => {
    if (args.onMessageAppended) {
      try { await args.onMessageAppended(m); } catch { /* best-effort */ }
    }
  };

  // Tool surface: prefer caller-supplied list (subagent), else mode-filter.
  const toolList: Tool[] = args.availableTools ?? toolsForMode(mode);
  const tools: ToolDefinition[] = toolList.map((t) => t.definition);
  const localToolByName = (name: string): Tool | undefined =>
    toolList.find((t) => t.definition.function.name === name) ?? toolByName(name);

  // Inject any caller-provided system messages (e.g. matched skills) ahead
  // of the most recent user message. We splice them into `messages` so
  // persistence layers see them too.
  if (args.injectedSystemMessages && args.injectedSystemMessages.length) {
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === 'user') { lastUserIdx = i; break; }
    }
    const insertAt = lastUserIdx >= 0 ? lastUserIdx : messages.length;
    messages.splice(insertAt, 0, ...args.injectedSystemMessages);
  }

  // Fire UserPromptSubmit on entry. If a hook returns {rewrite: string}, we
  // replace the most recent user message in `messages` (mutated in place).
  try {
    const lastUserIdx = (() => { for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.role === 'user') return i; return -1; })();
    const lastUser = lastUserIdx >= 0 ? messages[lastUserIdx]! : null;
    if (lastUser && typeof lastUser.content === 'string') {
      const agg = await runHooks({ event: 'UserPromptSubmit', payload: { prompt: lastUser.content }, cwd, signal });
      if (agg.rewrite !== undefined && agg.rewrite !== lastUser.content) {
        messages[lastUserIdx] = { ...lastUser, content: agg.rewrite };
        cb.log(`[hook] UserPromptSubmit rewrote prompt (${agg.rewrite.length} chars)`);
      }
    }
  } catch (e) { cb.log(`[hook] UserPromptSubmit failed: ${(e as Error).message}`); }

  for (let turn = 0; turn < maxTurns; turn++) {
    if (signal.aborted) { cb.onError('aborted'); return; }

    const pending = new Map<number, PendingToolCall>();
    let assistantContent = '';
    let assistantReasoning = '';
    let finish = 'stop';

    try {
      for await (const ev of client.stream({ messages, tools, model, signal })) {
        if (signal.aborted) return;
        switch (ev.kind) {
          case 'content':
            assistantContent += ev.delta;
            cb.onAssistantDelta(ev.delta);
            break;
          case 'reasoning':
            assistantReasoning += ev.delta;
            cb.onReasoningDelta(ev.delta);
            break;
          case 'tool_call_start': {
            const item: PendingToolCall = { id: ev.id, index: ev.index, name: ev.name, argsBuf: '' };
            pending.set(ev.index, item);
            cb.onToolCallStart(ev.id, ev.name);
            break;
          }
          case 'tool_call_args': {
            const item = pending.get(ev.index);
            if (item) {
              item.argsBuf += ev.argsDelta;
              cb.onToolCallArgs(item.id, ev.argsDelta);
            }
            break;
          }
          case 'usage':
            cb.onUsage(
              ev.usage.prompt_tokens ?? 0,
              ev.usage.completion_tokens ?? 0,
              estimateCostUSD(model, ev.usage),
            );
            break;
          case 'done':
            finish = ev.finishReason || 'stop';
            break;
          case 'error':
            cb.onError(ev.message);
            return;
        }
      }
    } catch (e) {
      cb.onError((e as Error).message);
      return;
    }

    // Append the assistant's turn (with any tool calls) to history.
    const toolCalls = Array.from(pending.values()).sort((a, b) => a.index - b.index);
    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: assistantContent || null,
      ...(assistantReasoning ? { reasoning_content: assistantReasoning } : {}),
      ...(toolCalls.length
        ? {
            tool_calls: toolCalls.map((t) => ({
              id: t.id,
              type: 'function' as const,
              function: { name: t.name, arguments: t.argsBuf || '{}' },
            })),
          }
        : {}),
    };
    messages.push(assistantMsg);
    await flush(assistantMsg);

    // No tools requested → terminate.
    if (toolCalls.length === 0) {
      // Fire Stop hook (read-only; output ignored).
      try {
        const last8 = messages.slice(-8).map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' }));
        await runHooks({ event: 'Stop', payload: { messages: last8 }, cwd, signal });
      } catch (e) { cb.log(`[hook] Stop failed: ${(e as Error).message}`); }
      cb.onTurnEnd(finish);
      return;
    }

    // Execute tool calls sequentially (parallelism is M3 work).
    for (const call of toolCalls) {
      if (signal.aborted) return;
      let parsed: any = {};
      try { parsed = call.argsBuf ? JSON.parse(call.argsBuf) : {}; }
      catch { /* fall through; tool will report error */ }
      cb.onToolCallReady(call.id, call.name, parsed);

      const tool = localToolByName(call.name);
      let result: { ok: boolean; content: string } = { ok: false, content: '' };

      // Plan mode: emit ExitPlanModeRequest for write tools and await user decision.
      if (mode === 'plan' && PLAN_BLOCKED_TOOLS.has(call.name)) {
        const decision = await new Promise<'exit-plan' | 'cancel'>((resolve) => {
          // Fallback timeout: if App.tsx doesn't respond in 30s, cancel.
          const timer = setTimeout(() => resolve('cancel'), 30_000);
          bus.publish('ExitPlanModeRequest', {
            toolName: call.name,
            resolve: (action) => { clearTimeout(timer); resolve(action); },
          });
        });
        if (decision === 'cancel') {
          result = { ok: false, content: `[plan mode] ${call.name} is not allowed in plan mode. Exit plan mode first.` };
          cb.onToolResult(call.id, call.name, result.ok, summariseResult(result.content));
          const toolMsg: ChatMessage = { role: 'tool', tool_call_id: call.id, name: call.name, content: result.content };
          messages.push(toolMsg);
          await flush(toolMsg);
          continue; // skip to next tool call
        }
        // decision === 'exit-plan': prevent re-prompting for subsequent tools in this turn
        if (decision === 'exit-plan') {
          mode = 'agent';
        }
      }

      // PreToolUse hook — may block.
      let blockedByHook = false;
      try {
        const pre = await runHooks({ event: 'PreToolUse', payload: { tool: call.name, args: parsed }, cwd, toolName: call.name, signal });
        if (pre.blocked) {
          blockedByHook = true;
          result = { ok: false, content: `Blocked by hook: ${pre.blockReason ?? '(no reason)'}` };
        }
      } catch (e) { cb.log(`[hook] PreToolUse failed: ${(e as Error).message}`); }

      if (!blockedByHook) {
        if (!tool) {
          result = { ok: false, content: `Unknown tool: ${call.name}` };
        } else {
          try {
            const r = await tool.run(parsed, ctx);
            // Read tool: track the file path so subsequent Write/Edit are allowed.
            if (r.ok && tool.definition.function.name === 'Read' && parsed?.file_path) {
              const { isAbsolute, resolve } = await import('node:path');
              const p = String(parsed.file_path);
              const abs = isAbsolute(p) ? p : resolve(cwd, p);
              markRead(abs, ctx);
            }
            result = { ok: r.ok, content: r.content };
          } catch (e) {
            result = { ok: false, content: `Tool threw: ${(e as Error).message}` };
          }
        }
      }

      // PostToolUse hook (output ignored).
      try {
        await runHooks({ event: 'PostToolUse', payload: { tool: call.name, args: parsed, ok: result.ok, content: result.content.slice(0, 4000) }, cwd, toolName: call.name, signal });
      } catch (e) { cb.log(`[hook] PostToolUse failed: ${(e as Error).message}`); }

      cb.onToolResult(call.id, call.name, result.ok, summariseResult(result.content));
      const toolMsg: ChatMessage = {
        role: 'tool',
        tool_call_id: call.id,
        name: call.name,
        content: result.content,
      };
      messages.push(toolMsg);
      await flush(toolMsg);
    }

    // Loop: feed tool results back to the model for follow-up.
  }

  cb.onError(`Stopped after ${maxTurns} turns without a final reply.`);
}

function summariseResult(content: string): string {
  const firstLine = content.split('\n')[0] ?? '';
  if (content.length <= 200) return content;
  return `${firstLine.slice(0, 200)}…  (${content.length} chars)`;
}
