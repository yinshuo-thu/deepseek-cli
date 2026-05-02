// Line-delimited JSON-RPC v2 framer. Pending-id Map. `call(method, params)`
// returns Promise. Handles requests, responses, notifications.

import type { MCPTransport } from './types.js';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}
export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export type JsonRpcInbound = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export class JsonRpcEndpoint {
  private nextId = 1;
  private pending = new Map<number | string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer?: NodeJS.Timeout }>();
  private notificationHandlers: Array<(msg: JsonRpcNotification) => void> = [];
  private requestHandlers: Array<(msg: JsonRpcRequest) => Promise<unknown> | unknown> = [];
  private buf = '';

  constructor(private transport: MCPTransport) {
    transport.onLine((line) => this.onLine(line));
    transport.onClose((err) => this.failAllPending(err ?? new Error('transport closed')));
  }

  /** Append framer-buffered partial chunks if the transport delivers raw bytes. */
  feed(chunk: string): void {
    this.buf += chunk;
    let idx;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const ln = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      const trimmed = ln.replace(/\r$/, '').trim();
      if (trimmed) this.onLine(trimmed);
    }
  }

  private onLine(line: string): void {
    let msg: JsonRpcInbound;
    try { msg = JSON.parse(line); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if ('id' in msg && (msg as JsonRpcResponse).result !== undefined || (msg as any).error) {
      // Could be either response or request.id present is also a request — distinguish by presence of method.
      if ((msg as JsonRpcRequest).method) {
        this.handleRequest(msg as JsonRpcRequest);
      } else {
        this.handleResponse(msg as JsonRpcResponse);
      }
      return;
    }
    if ('id' in msg) {
      // request with id
      this.handleRequest(msg as JsonRpcRequest);
      return;
    }
    // notification (no id)
    if ((msg as JsonRpcNotification).method) {
      for (const h of this.notificationHandlers) {
        try { h(msg as JsonRpcNotification); } catch { /* ignore */ }
      }
    }
  }

  private handleResponse(msg: JsonRpcResponse): void {
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (p.timer) clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(`JSON-RPC error ${msg.error.code}: ${msg.error.message}`));
    else p.resolve(msg.result);
  }

  private async handleRequest(msg: JsonRpcRequest): Promise<void> {
    let result: unknown = null;
    let error: { code: number; message: string } | undefined;
    try {
      let handled = false;
      for (const h of this.requestHandlers) {
        const r = await h(msg);
        if (r !== undefined) { result = r; handled = true; break; }
      }
      if (!handled) error = { code: -32601, message: `Method not found: ${msg.method}` };
    } catch (e) {
      error = { code: -32603, message: (e as Error).message };
    }
    const reply: JsonRpcResponse = { jsonrpc: '2.0', id: msg.id, ...(error ? { error } : { result }) };
    this.send(reply);
  }

  private send(obj: unknown): void {
    this.transport.send(JSON.stringify(obj) + '\n');
  }

  call<T = unknown>(method: string, params?: unknown, opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<T> {
    const id = this.nextId++;
    const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) };
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('aborted'));
        }
      };
      const timer = opts?.timeoutMs ? setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout after ${opts.timeoutMs}ms (method=${method})`));
        }
      }, opts.timeoutMs) : undefined;
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject, ...(timer ? { timer } : {}) });
      if (opts?.signal) {
        if (opts.signal.aborted) onAbort();
        else opts.signal.addEventListener('abort', onAbort, { once: true });
      }
      try {
        this.send(req);
      } catch (e) {
        this.pending.delete(id);
        if (timer) clearTimeout(timer);
        reject(e as Error);
      }
    });
  }

  notify(method: string, params?: unknown): void {
    const m: JsonRpcNotification = { jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) };
    this.send(m);
  }

  onNotification(h: (msg: JsonRpcNotification) => void): void {
    this.notificationHandlers.push(h);
  }

  onRequest(h: (msg: JsonRpcRequest) => Promise<unknown> | unknown): void {
    this.requestHandlers.push(h);
  }

  private failAllPending(err: Error): void {
    for (const [, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }
}
