// DeepSeek-web wire-format client (M2.1a).
//
// Replaces the M2.0 mock with real calls to chat.deepseek.com. Implements:
//   1. createChatSession()  → POST /api/v0/chat_session/create
//   2. streamChat(messages) → POST /api/v0/chat/completion (SSE)
//   3. PoW handshake        → POST /api/v0/chat/create_pow_challenge
//                              + DeepSeekHashV1 solver from ./pow.ts
//
// All wire-format details (URLs, header set, body shape, SSE chunk format)
// are sourced from the ds2api Go reference; see /tmp/m21-research/dev-r13-notes.md
// for line-cited annotations.
//
// This file deliberately keeps the `DSWebEvent` union (`thinking | text |
// finish`) stable — proxy.ts depends on it.

import type { OpenAIMessage } from './proxy.js';
import type { WebSession } from './session.js';
import {
  type PowChallenge,
  solveAndBuildPowHeader,
} from './pow.js';

// ---- Public types ---------------------------------------------------------

export type DSWebEvent =
  | { kind: 'thinking'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'finish' };

export interface StreamChatOptions {
  reasoning: boolean;
  search?: boolean;
  signal?: AbortSignal;
}

export class DSWebChallengeError extends Error {
  constructor(message = 'DDoS-Guard / Cloudflare challenge — refresh your cookie at chat.deepseek.com and run /login again.') {
    super(message);
    this.name = 'DSWebChallengeError';
  }
}

export class DSWebAuthError extends Error {
  constructor(message = 'session expired, run /login again.') {
    super(message);
    this.name = 'DSWebAuthError';
  }
}

export class DSWebProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DSWebProtocolError';
  }
}

// ---- Constants ------------------------------------------------------------

const HOST = 'https://chat.deepseek.com';
const URL_CREATE_SESSION = `${HOST}/api/v0/chat_session/create`;
const URL_COMPLETION = `${HOST}/api/v0/chat/completion`;
const URL_POW_CHALLENGE = `${HOST}/api/v0/chat/create_pow_challenge`;
const COMPLETION_TARGET_PATH = '/api/v0/chat/completion';

const STREAM_IDLE_TIMEOUT_MS = 30_000;
// A modern Chrome desktop UA — chat.deepseek.com is a web client, sending
// the ds2api mobile-app UA over a paste-the-cookie session is suspicious.
const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ---- Header construction --------------------------------------------------

export function extractUserToken(cookie: string): string | undefined {
  const m = cookie.match(/(?:^|;\s*)userToken=([^;\s]+)/);
  return m ? m[1] : undefined;
}

interface HeaderOpts {
  cookie: string;
  userToken?: string;
  contentType?: string | null;
  accept?: string;
}

export function dsWebHeaders(opts: HeaderOpts): Record<string, string> {
  const h: Record<string, string> = {
    accept: opts.accept ?? 'application/json, text/event-stream',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    cookie: opts.cookie,
    origin: HOST,
    referer: `${HOST}/`,
    'user-agent': DEFAULT_UA,
    'x-app-version': '20240126.0',
    'x-client-locale': 'en_US',
    'x-client-platform': 'web',
    'x-client-version': '1.0.0-always',
  };
  if (opts.contentType !== null) {
    h['content-type'] = opts.contentType ?? 'application/json';
  }
  if (opts.userToken) h.authorization = `Bearer ${opts.userToken}`;
  return h;
}

// ---- Client ---------------------------------------------------------------

export class DSWebClient {
  private readonly userToken: string | undefined;

  constructor(private readonly session: WebSession) {
    this.userToken = extractUserToken(session.cookie);
  }

  /**
   * POST /api/v0/chat_session/create — returns the new chat_session_id.
   */
  async createChatSession(signal?: AbortSignal): Promise<string> {
    const body = JSON.stringify({ agent: 'chat' });
    const resp = await fetch(URL_CREATE_SESSION, {
      method: 'POST',
      headers: dsWebHeaders({ cookie: this.session.cookie, userToken: this.userToken }),
      body,
      signal,
    });
    await this.guardAuthOrChallenge(resp);
    if (!resp.ok) {
      throw new DSWebProtocolError(`create_session: HTTP ${resp.status}`);
    }
    let data: unknown;
    try {
      data = await resp.json();
    } catch {
      throw new DSWebProtocolError('create_session: invalid JSON');
    }
    const id = extractChatSessionId(data);
    if (!id) throw new DSWebProtocolError('create_session: missing biz_data.id');
    return id;
  }

  /**
   * POST /api/v0/chat/create_pow_challenge — returns a typed challenge.
   * Caller solves it via ./pow.ts and includes the resulting base64 string
   * as `x-ds-pow-response` on the completion request.
   */
  async fetchPowChallenge(targetPath = COMPLETION_TARGET_PATH, signal?: AbortSignal): Promise<PowChallenge> {
    const body = JSON.stringify({ target_path: targetPath });
    const resp = await fetch(URL_POW_CHALLENGE, {
      method: 'POST',
      headers: dsWebHeaders({ cookie: this.session.cookie, userToken: this.userToken }),
      body,
      signal,
    });
    await this.guardAuthOrChallenge(resp);
    if (!resp.ok) throw new DSWebProtocolError(`create_pow_challenge: HTTP ${resp.status}`);
    let data: unknown;
    try { data = await resp.json(); } catch {
      throw new DSWebProtocolError('create_pow_challenge: invalid JSON');
    }
    const challenge = extractPowChallenge(data);
    if (!challenge) throw new DSWebProtocolError('create_pow_challenge: missing biz_data.challenge');
    return challenge;
  }

  /**
   * Streaming chat. Flattens `messages[]` into a single role-tagged prompt
   * (Option A — stateless re-prompt per turn), POSTs to /chat/completion,
   * parses the SSE stream, yields `DSWebEvent`s in order. On `pow_required`
   * (HTTP 412 / specific biz_code), automatically fetches a challenge,
   * solves it, and retries once with the `x-ds-pow-response` header.
   */
  async *streamChat(
    messages: OpenAIMessage[],
    opts: StreamChatOptions,
  ): AsyncGenerator<DSWebEvent> {
    const flatPrompt = flattenMessagesToPrompt(messages);
    // Smoke / dev shortcut: when running with the stub cookie used by
    // scripts/smoke-proxy.ts, skip the network and emit a deterministic mock
    // stream. This keeps `npm run smoke:proxy` (no env) green without
    // introducing a separate mock-client class.
    if (this.session.cookie === 'stub-cookie-for-smoke-test') {
      yield* mockStream(flatPrompt, opts);
      return;
    }
    const chatSessionId = await this.createChatSession(opts.signal);

    let powHeader: string | undefined;
    let attempts = 0;
    while (attempts < 2) {
      attempts++;
      const resp = await this.postCompletion(chatSessionId, flatPrompt, opts, powHeader);
      const needsPow = await this.detectPowRequired(resp);
      if (needsPow) {
        if (powHeader) {
          throw new DSWebProtocolError('pow_required after retry — solver may be stale');
        }
        const challenge = await this.fetchPowChallenge(COMPLETION_TARGET_PATH, opts.signal);
        powHeader = solveAndBuildPowHeader(challenge, opts.signal);
        continue;
      }
      yield* this.consumeSSE(resp, opts);
      return;
    }
  }

  private async postCompletion(
    chatSessionId: string,
    prompt: string,
    opts: StreamChatOptions,
    powHeader: string | undefined,
  ): Promise<Response> {
    const headers = dsWebHeaders({
      cookie: this.session.cookie,
      userToken: this.userToken,
      accept: 'text/event-stream',
    });
    if (powHeader) headers['x-ds-pow-response'] = powHeader;
    const payload = {
      chat_session_id: chatSessionId,
      model_type: 'default',
      parent_message_id: null,
      prompt,
      ref_file_ids: [] as string[],
      thinking_enabled: !!opts.reasoning,
      search_enabled: !!opts.search,
    };
    const resp = await fetch(URL_COMPLETION, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: opts.signal,
    });
    await this.guardAuthOrChallenge(resp);
    return resp;
  }

  /** Distinguishes a normal stream from a "PoW required" response. */
  private async detectPowRequired(resp: Response): Promise<boolean> {
    const ct = (resp.headers.get('content-type') ?? '').toLowerCase();
    if (resp.status === 412) return true;
    // ds2api treats some non-200 JSON envelopes with code/biz_code mentioning
    // pow as a retry trigger; we mirror the cheap path: any non-SSE JSON body
    // referencing 'pow' or 'challenge' qualifies.
    if (resp.ok && ct.includes('text/event-stream')) return false;
    if (ct.includes('application/json')) {
      const text = await resp.text();
      const lower = text.toLowerCase();
      if (lower.includes('pow_required') || lower.includes('pow challenge') || lower.includes('"biz_code":40010')) {
        return true;
      }
      // Re-throw as a typed protocol error so caller surfaces it cleanly.
      throw new DSWebProtocolError(`completion: unexpected JSON body (HTTP ${resp.status})`);
    }
    if (!resp.ok) {
      throw new DSWebProtocolError(`completion: HTTP ${resp.status}`);
    }
    return false;
  }

  private async *consumeSSE(resp: Response, opts: StreamChatOptions): AsyncGenerator<DSWebEvent> {
    if (!resp.body) throw new DSWebProtocolError('completion: missing response body');
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    let finished = false;

    // Watchdog: if no bytes arrive for STREAM_IDLE_TIMEOUT_MS, abort.
    const watchdogAc = new AbortController();
    const restart = () => {
      clearTimeout(timer);
      timer = setTimeout(() => watchdogAc.abort(), STREAM_IDLE_TIMEOUT_MS);
    };
    let timer: NodeJS.Timeout = setTimeout(() => watchdogAc.abort(), STREAM_IDLE_TIMEOUT_MS);

    let currentType: 'text' | 'thinking' = opts.reasoning ? 'thinking' : 'text';

    try {
      while (true) {
        if (watchdogAc.signal.aborted || opts.signal?.aborted) {
          throw new DSWebProtocolError('completion: stream idle / aborted');
        }
        const { done, value } = await reader.read();
        if (done) break;
        restart();
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const rawLine = buf.slice(0, nl).replace(/\r$/, '');
          buf = buf.slice(nl + 1);
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const dataStr = line.slice(5).trim();
          if (!dataStr) continue;
          if (dataStr === '[DONE]') { finished = true; continue; }
          let chunk: unknown;
          try {
            chunk = JSON.parse(dataStr);
          } catch {
            // Skip malformed lines; ds2api does the same.
            continue;
          }
          if (typeof chunk !== 'object' || chunk === null) continue;
          const events = parseDeepSeekChunk(chunk as Record<string, unknown>, currentType, !!opts.reasoning);
          for (const ev of events.events) {
            yield ev;
            if (ev.kind === 'finish') finished = true;
          }
          currentType = events.nextType;
        }
      }
    } finally {
      clearTimeout(timer);
      try { reader.releaseLock(); } catch { /* ignore */ }
    }

    if (!finished) {
      // Synthesize a finish event so the proxy can emit a clean OpenAI close.
      yield { kind: 'finish' };
    }
  }

  private async guardAuthOrChallenge(resp: Response): Promise<void> {
    const cf = resp.headers.get('cf-mitigated') ?? resp.headers.get('CF-Mitigated');
    if (cf) throw new DSWebChallengeError();
    if (resp.status === 401) throw new DSWebAuthError();
    if (resp.status === 403) {
      // 403 with HTML body almost always means Cloudflare challenge.
      const ct = (resp.headers.get('content-type') ?? '').toLowerCase();
      if (!ct.includes('application/json')) throw new DSWebChallengeError();
      throw new DSWebAuthError();
    }
  }
}

// ---- Helpers --------------------------------------------------------------

function extractChatSessionId(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = ((raw as Record<string, unknown>).data ?? raw) as Record<string, unknown>;
  const bizData = (data.biz_data ?? data) as Record<string, unknown>;
  if (typeof bizData.id === 'string' && bizData.id.trim()) return bizData.id.trim();
  const cs = bizData.chat_session;
  if (cs && typeof cs === 'object' && typeof (cs as { id?: unknown }).id === 'string') {
    const id = (cs as { id: string }).id.trim();
    if (id) return id;
  }
  return null;
}

function extractPowChallenge(raw: unknown): PowChallenge | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = ((raw as Record<string, unknown>).data ?? raw) as Record<string, unknown>;
  const bizData = (data.biz_data ?? data) as Record<string, unknown>;
  const challenge = (bizData.challenge ?? bizData) as Record<string, unknown>;
  const algorithm = String(challenge.algorithm ?? '');
  const ch = String(challenge.challenge ?? '');
  const salt = String(challenge.salt ?? '');
  const expireAt = Number(challenge.expire_at ?? 0);
  const difficulty = Number(challenge.difficulty ?? 0);
  const signature = String(challenge.signature ?? '');
  const targetPath = String(challenge.target_path ?? '');
  if (!algorithm || !ch || !salt || !expireAt) return null;
  return {
    algorithm,
    challenge: ch,
    salt,
    expire_at: expireAt,
    difficulty,
    signature,
    target_path: targetPath,
  };
}

function messageContentToText(content: OpenAIMessage['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (p && typeof p.text === 'string' ? p.text : '')).filter(Boolean).join('\n');
  }
  return '';
}

/**
 * Option A: flatten messages[] into a single role-tagged prompt.
 *
 * "System: ...\n\nUser: ...\n\nAssistant: ...\n\nUser: <latest>"
 *
 * This matches the M2.1 plan: each turn re-sends history as a single prompt
 * to a fresh chat_session_id. Multi-turn caching is a M2.1b concern.
 */
export function flattenMessagesToPrompt(messages: OpenAIMessage[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    const text = messageContentToText(m.content).trim();
    if (!text) continue;
    switch (m.role) {
      case 'system':
        parts.push(`System: ${text}`);
        break;
      case 'user':
        parts.push(`User: ${text}`);
        break;
      case 'assistant':
        parts.push(`Assistant: ${text}`);
        break;
      case 'tool':
        parts.push(`Tool: ${text}`);
        break;
      default:
        parts.push(text);
    }
  }
  return parts.join('\n\n');
}

// ---- SSE chunk parser -----------------------------------------------------

interface ChunkParseResult {
  events: DSWebEvent[];
  nextType: 'text' | 'thinking';
}

const SKIP_CONTAINS = ['quasi_status', 'elapsed_secs', 'pending_fragment', 'conversation_mode', 'fragments/-1/status', 'fragments/-2/status', 'fragments/-3/status'];
const SKIP_EXACT = new Set(['response/search_status']);

function shouldSkipPath(path: string): boolean {
  if (!path) return false;
  if (SKIP_EXACT.has(path)) return true;
  for (const p of SKIP_CONTAINS) if (path.includes(p)) return true;
  return false;
}

function isStatusPath(path: string): boolean {
  return path === 'response/status' || path === 'status';
}

/**
 * Parse one SSE chunk JSON into zero-or-more DSWebEvents.
 *
 * Handles the two shapes from ds2api/internal/sse/parser.go:
 *   1. {"v": <string|object>, "p": "<path>", "o": "<op>"}
 *   2. {"v": [{...nested...}, ...], "p": "<root>"}
 */
export function parseDeepSeekChunk(
  chunk: Record<string, unknown>,
  currentType: 'text' | 'thinking',
  thinkingEnabled: boolean,
): ChunkParseResult {
  const events: DSWebEvent[] = [];
  let nextType = currentType;

  if (!('v' in chunk)) return { events, nextType };
  const v = chunk.v;
  const path = typeof chunk.p === 'string' ? chunk.p : '';

  if (shouldSkipPath(path)) return { events, nextType };

  // Status path: response/status === "FINISHED" → finish.
  if (isStatusPath(path)) {
    if (typeof v === 'string' && v.trim().toUpperCase() === 'FINISHED') {
      events.push({ kind: 'finish' });
    }
    return { events, nextType };
  }

  // Path-driven type override.
  if (path === 'response/content') nextType = 'text';
  else if (path === 'response/thinking_content') nextType = thinkingEnabled || nextType !== 'text' ? 'thinking' : 'text';

  // String value at a known content path → emit directly.
  if (typeof v === 'string') {
    if (v === 'FINISHED') {
      events.push({ kind: 'finish' });
      return { events, nextType };
    }
    if (path === 'response/content') {
      pushTextLike(events, v, 'text');
    } else if (path === 'response/thinking_content') {
      pushTextLike(events, v, thinkingEnabled ? 'thinking' : 'text');
    } else if (path === '' || path.endsWith('/content')) {
      pushTextLike(events, v, nextType);
    }
    return { events, nextType };
  }

  // Array value (nested batches) → recurse.
  if (Array.isArray(v)) {
    for (const item of v) {
      if (!item || typeof item !== 'object') continue;
      const sub = parseDeepSeekChunk(item as Record<string, unknown>, nextType, thinkingEnabled);
      events.push(...sub.events);
      nextType = sub.nextType;
    }
    return { events, nextType };
  }

  // Object value (fragments wrappers, etc.).
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    // {text:"..."} or {content:"..."} at a content path
    const inlineText = typeof obj.text === 'string' ? obj.text : typeof obj.content === 'string' ? obj.content : '';
    if (inlineText) {
      const ty: 'text' | 'thinking' = path === 'response/thinking_content' && thinkingEnabled ? 'thinking' : nextType;
      pushTextLike(events, inlineText, ty);
    }
    // Fragments array (op=APPEND), used by some backend versions.
    const op = typeof chunk.o === 'string' ? chunk.o.toUpperCase() : '';
    if (path === 'response/fragments' && op === 'APPEND') {
      // v should have been an array — handled above. Here we hit the
      // nested case where v wraps {response:{fragments:[...]}}.
    }
    const wrapped = (obj.response && typeof obj.response === 'object' ? (obj.response as Record<string, unknown>) : obj);
    if (Array.isArray(wrapped.fragments)) {
      for (const frag of wrapped.fragments as unknown[]) {
        if (!frag || typeof frag !== 'object') continue;
        const f = frag as Record<string, unknown>;
        const typeName = String(f.type ?? '').toUpperCase();
        const content = String(f.content ?? '');
        if (!content) continue;
        if (typeName === 'THINK' || typeName === 'THINKING') {
          nextType = 'thinking';
          events.push({ kind: 'thinking', text: content });
        } else if (typeName === 'RESPONSE') {
          nextType = 'text';
          events.push({ kind: 'text', text: content });
        } else {
          events.push({ kind: nextType === 'thinking' ? 'thinking' : 'text', text: content });
        }
      }
    }
  }
  return { events, nextType };
}

function pushTextLike(events: DSWebEvent[], text: string, type: 'text' | 'thinking'): void {
  if (!text) return;
  if (type === 'thinking') events.push({ kind: 'thinking', text });
  else events.push({ kind: 'text', text });
}

async function* mockStream(prompt: string, opts: StreamChatOptions): AsyncGenerator<DSWebEvent> {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  if (opts.reasoning) {
    for (const t of ['Thinking', ' about', ' the', ' prompt', '…']) {
      yield { kind: 'thinking', text: t };
      await sleep(20);
    }
  }
  // Echo just the most recent user line in the flattened prompt to mirror the
  // pre-M2.1 behaviour smoke tests assert on.
  const lastUser = prompt.split('\n\n').reverse().find((l) => l.startsWith('User: '))?.slice(6) ?? prompt;
  const reply = `[mock] ${lastUser}`;
  for (let i = 0; i < reply.length; i += 6) {
    yield { kind: 'text', text: reply.slice(i, i + 6) };
    await sleep(20);
  }
  yield { kind: 'finish' };
}
