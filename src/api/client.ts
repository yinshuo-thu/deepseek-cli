import type { ChatRequest, StreamEvent, ToolDefinition, ChatMessage, UsageDelta } from './types.js';
import type { Config } from '../config/index.js';

export interface StreamCallOptions {
  signal?: AbortSignal;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export class DeepSeekAPIError extends Error {
  constructor(message: string, readonly status?: number, readonly body?: string) {
    super(message);
    this.name = 'DeepSeekAPIError';
  }
}

export class DeepSeekClient {
  constructor(private readonly cfg: Config) {}

  /** Stream a chat completion. Yields normalised StreamEvents. */
  async *stream(opts: StreamCallOptions): AsyncGenerator<StreamEvent> {
    if (!this.cfg.apiKey) {
      yield { kind: 'error', message: 'No API key. Run `deepseek` and complete first-run setup, or set $DEEPSEEK_API_KEY.' };
      return;
    }

    const body: ChatRequest = {
      model: opts.model ?? this.cfg.model,
      messages: opts.messages,
      stream: true,
      ...(opts.tools && opts.tools.length ? { tools: opts.tools, tool_choice: 'auto' as const } : {}),
      ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
      ...(opts.maxTokens != null ? { max_tokens: opts.maxTokens } : {}),
    };

    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.cfg.apiKey}`,
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal: opts.signal,
      });
    } catch (e) {
      const msg = (e as Error).message;
      yield { kind: 'error', message: `network: ${msg}` };
      return;
    }

    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => '');
      yield { kind: 'error', message: `HTTP ${res.status}: ${txt.slice(0, 400)}` };
      return;
    }

    yield* this.parseSSE(res.body);
  }

  /** Parse OpenAI-format SSE stream. Tool-call args may arrive in fragments. */
  private async *parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).replace(/\r$/, '');
          buf = buf.slice(nl + 1);
          if (!line || !line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') {
            yield { kind: 'done', finishReason: 'stop' };
            return;
          }
          let json: any;
          try { json = JSON.parse(data); } catch { continue; }

          const choice = json.choices?.[0];
          if (choice) {
            const delta = choice.delta ?? {};
            if (typeof delta.content === 'string' && delta.content) {
              yield { kind: 'content', delta: delta.content };
            }
            if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
              yield { kind: 'reasoning', delta: delta.reasoning_content };
            }
            if (Array.isArray(delta.tool_calls)) {
              for (const tc of delta.tool_calls) {
                const idx: number = tc.index ?? 0;
                if (tc.id || tc.function?.name) {
                  yield {
                    kind: 'tool_call_start',
                    id: tc.id ?? `call_${idx}`,
                    name: tc.function?.name ?? '',
                    index: idx,
                  };
                }
                if (typeof tc.function?.arguments === 'string') {
                  yield { kind: 'tool_call_args', index: idx, argsDelta: tc.function.arguments };
                }
              }
            }
            if (choice.finish_reason) {
              yield { kind: 'done', finishReason: choice.finish_reason };
            }
          }

          if (json.usage) {
            yield { kind: 'usage', usage: json.usage as UsageDelta };
          }
        }
      }
      yield { kind: 'done', finishReason: 'stop' };
    } catch (e) {
      const msg = (e as Error).message;
      if (msg !== 'aborted') yield { kind: 'error', message: msg };
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  }
}

// Pricing in USD per million tokens. Source: api-docs.deepseek.com/quick_start/pricing
export const PRICING: Record<string, { inHit: number; inMiss: number; out: number }> = {
  'deepseek-v4-flash': { inHit: 0.0028, inMiss: 0.14,  out: 0.28 },
  'deepseek-v4-pro':   { inHit: 0.003625, inMiss: 0.435, out: 0.87 },
};

export function estimateCostUSD(model: string, u: UsageDelta): number {
  const p = PRICING[model] ?? PRICING['deepseek-v4-flash']!;
  const hit = u.prompt_cache_hit_tokens ?? 0;
  const miss = u.prompt_cache_miss_tokens ?? Math.max(0, (u.prompt_tokens ?? 0) - hit);
  const out = u.completion_tokens ?? 0;
  return (hit * p.inHit + miss * p.inMiss + out * p.out) / 1_000_000;
}
