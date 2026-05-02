// OpenAI-compatible proxy mounted on the local auth server.
//
// Accepts standard OpenAI `/v1/chat/completions` requests (streaming SSE) and
// translates them into DSWebClient calls. v1 backend is the in-process mock
// from dswebClient.ts; M2.1 will swap in the real DeepSeek-web wire format
// without touching the existing api/client.ts (which already speaks
// OpenAI-compatible SSE).

import type { IncomingMessage, ServerResponse } from 'node:http';

import { DSWebClient, type DSWebEvent } from './dswebClient.js';

const MAX_PROXY_BODY_BYTES = 1024 * 1024; // 1 MB

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | Array<{ type: string; text?: string }>;
}

interface OpenAIChatRequest {
  model?: string;
  messages?: OpenAIMessage[];
  stream?: boolean;
  reasoning_effort?: 'off' | 'high' | 'max' | string;
}

const SUPPORTED_MODELS = [
  { id: 'deepseek-v4-flash' },
  { id: 'deepseek-v4-pro' },
  { id: 'deepseek-reasoner' },
];

export class OpenAIProxy {
  constructor(private readonly client: DSWebClient | null) {}

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/';
    const method = (req.method ?? 'GET').toUpperCase();

    if (method === 'GET' && (url === '/v1/models' || url === '/v1/models/')) {
      this.sendJson(res, 200, { data: SUPPORTED_MODELS, object: 'list' });
      return;
    }

    if (method === 'POST' && (url === '/v1/chat/completions' || url === '/v1/chat/completions/')) {
      if (!this.client) {
        this.sendJson(res, 401, {
          error: {
            message: 'no DeepSeek web session loaded; run /login first',
            type: 'invalid_request_error',
            code: 'session_missing',
          },
        });
        return;
      }
      let body: string;
      try {
        body = await readBodyCapped(req, MAX_PROXY_BODY_BYTES);
      } catch (err) {
        const tooBig = err instanceof Error && err.message.includes('exceeded');
        this.sendJson(res, tooBig ? 413 : 400, {
          error: {
            message: tooBig ? 'request body exceeded 1 MB cap' : 'failed to read request body',
            type: 'invalid_request_error',
          },
        });
        try { req.socket.destroy(); } catch { /* ignore */ }
        return;
      }
      let parsed: OpenAIChatRequest;
      try {
        parsed = JSON.parse(body) as OpenAIChatRequest;
      } catch {
        this.sendJson(res, 400, {
          error: { message: 'invalid JSON', type: 'invalid_request_error' },
        });
        return;
      }
      const prompt = lastUserPrompt(parsed.messages ?? []);
      if (!prompt) {
        this.sendJson(res, 400, {
          error: { message: 'no user message found', type: 'invalid_request_error' },
        });
        return;
      }
      const reasoning =
        parsed.model === 'deepseek-reasoner' || parsed.reasoning_effort === 'max';

      await this.streamChat(res, prompt, { reasoning, model: parsed.model ?? 'deepseek-v4-flash' });
      return;
    }

    this.sendJson(res, 404, {
      error: { message: `unknown route ${method} ${url}`, type: 'invalid_request_error' },
    });
  }

  private async streamChat(
    res: ServerResponse,
    prompt: string,
    opts: { reasoning: boolean; model: string },
  ): Promise<void> {
    if (!this.client) return; // already guarded above
    res.statusCode = 200;
    res.setHeader('content-type', 'text/event-stream; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('connection', 'keep-alive');
    res.flushHeaders?.();

    const id = `chatcmpl-${Date.now().toString(36)}`;
    const created = Math.floor(Date.now() / 1000);
    const model = opts.model;

    const writeChunk = (delta: Record<string, unknown>, finish?: string) => {
      const payload = {
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [
          {
            index: 0,
            delta,
            ...(finish ? { finish_reason: finish } : {}),
          },
        ],
      };
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      // Initial role chunk so OpenAI clients see a stable start.
      writeChunk({ role: 'assistant' });

      for await (const ev of this.client.streamChat(prompt, { reasoning: opts.reasoning })) {
        const oai = translateEvent(ev);
        if (!oai) continue;
        if (oai.finish) {
          writeChunk({}, oai.finish);
        } else if (oai.delta) {
          writeChunk(oai.delta);
        }
      }
      res.write('data: [DONE]\n\n');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.write(
        `data: ${JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: 'error' }],
          error: { message: msg, type: 'server_error' },
        })}\n\n`,
      );
      res.write('data: [DONE]\n\n');
    } finally {
      try { res.end(); } catch { /* ignore */ }
    }
  }

  private sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(body));
  }
}

function lastUserPrompt(messages: OpenAIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) {
      return m.content
        .map((p) => (p && typeof p.text === 'string' ? p.text : ''))
        .filter(Boolean)
        .join('\n');
    }
  }
  return '';
}

function translateEvent(ev: DSWebEvent): { delta?: Record<string, unknown>; finish?: string } | null {
  switch (ev.kind) {
    case 'text':
      return { delta: { content: ev.text } };
    case 'thinking':
      return { delta: { reasoning_content: ev.text } };
    case 'finish':
      return { finish: 'stop' };
    default:
      return null;
  }
}

async function readBodyCapped(req: IncomingMessage, maxBytes: number): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;
    req.on('data', (c: Buffer) => {
      if (aborted) return;
      total += c.length;
      if (total > maxBytes) {
        aborted = true;
        try { req.socket.destroy(); } catch { /* ignore */ }
        reject(new Error('request body exceeded cap'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (aborted) return;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => {
      if (aborted) return;
      reject(err);
    });
  });
}
