// The agent loop: stream → accumulate tool calls → run tools → loop until plain reply.
//
// Owned by App.tsx via a callbacks bag. We emit fine-grained events so the UI
// can render tokens as they arrive, show tool cards, and request permissions.

import type { ChatMessage } from '../api/types.js';
import { DeepSeekClient, estimateCostUSD } from '../api/client.js';
import { ALL_TOOLS, toolByName, markRead } from '../tools/index.js';
import type { ToolContext } from '../tools/types.js';

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
  maxTurns?: number;
}): Promise<void> {
  const { client, messages, cwd, model, signal, cb } = args;
  const maxTurns = args.maxTurns ?? 25;
  const persistentlyAllowed = new Set<string>(); // tools allowed for the rest of the turn-chain

  const ctx: ToolContext = {
    cwd,
    log: cb.log,
    async requestPermission(tool, summary) {
      if (persistentlyAllowed.has(tool)) return 'once';
      const decision = await cb.requestPermission(tool, summary);
      if (decision === 'always') persistentlyAllowed.add(tool);
      return decision;
    },
  };

  const tools = ALL_TOOLS.map((t) => t.definition);

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

    // No tools requested → terminate.
    if (toolCalls.length === 0) {
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

      const tool = toolByName(call.name);
      let result: { ok: boolean; content: string };
      if (!tool) {
        result = { ok: false, content: `Unknown tool: ${call.name}` };
      } else {
        try {
          const r = await tool.run(parsed, ctx);
          // Read tool: track the file path so subsequent Write/Edit are allowed.
          if (r.ok && tool.definition.function.name === 'Read' && parsed?.file_path) {
            markRead(String(parsed.file_path));
          }
          result = { ok: r.ok, content: r.content };
        } catch (e) {
          result = { ok: false, content: `Tool threw: ${(e as Error).message}` };
        }
      }
      cb.onToolResult(call.id, call.name, result.ok, summariseResult(result.content));
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.name,
        content: result.content,
      });
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
