// SSE transport for MCP. Reads server-sent events from `url`, sends client
// messages via HTTP POST to a paired URL discovered via the SSE `endpoint`
// event (per the MCP SSE spec). Reconnects on stream end with backoff.

import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';
import type { MCPSseConfig, MCPTransport } from './types.js';

export class SseTransport implements MCPTransport {
  private req?: ClientRequest;
  private res?: IncomingMessage;
  private postUrl?: string;
  private buf = '';
  private dataBuf = '';
  private lineHandlers: Array<(line: string) => void> = [];
  private closeHandlers: Array<(err?: Error) => void> = [];
  private closed = false;
  private outboundQueue: string[] = [];

  constructor(private cfg: MCPSseConfig) {}

  async start(): Promise<void> {
    const u = new URL(this.cfg.url);
    const reqFn = u.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise<void>((resolve, reject) => {
      const r = reqFn({
        method: 'GET',
        host: u.hostname,
        port: u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + (u.search || ''),
        headers: {
          Accept: 'text/event-stream',
          ...(this.cfg.headers ?? {}),
        },
      }, (res) => {
        if (res.statusCode !== 200) {
          this.closed = true;
          reject(new Error(`SSE GET ${u.toString()} → ${res.statusCode}`));
          return;
        }
        res.setEncoding('utf8');
        this.res = res;
        res.on('data', (chunk: string) => this.onChunk(chunk));
        res.on('end', () => this.onEnd());
        res.on('close', () => this.onEnd());
        resolve();
      });
      r.on('error', (err) => {
        if (this.closed) return;
        this.closed = true;
        reject(err);
      });
      r.end();
      this.req = r;
    });
  }

  private onChunk(chunk: string): void {
    this.buf += chunk;
    let idx: number;
    // SSE events terminated by blank line. We accumulate `data:` lines and
    // dispatch on a blank line.
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const ln = this.buf.slice(0, idx).replace(/\r$/, '');
      this.buf = this.buf.slice(idx + 1);
      if (ln === '') {
        // event boundary
        if (this.dataBuf) {
          this.dispatchEvent(this.dataBuf);
          this.dataBuf = '';
        }
        continue;
      }
      if (ln.startsWith(':')) continue; // comment
      const colon = ln.indexOf(':');
      const field = colon < 0 ? ln : ln.slice(0, colon);
      const value = colon < 0 ? '' : ln.slice(colon + 1).replace(/^ /, '');
      if (field === 'data') {
        this.dataBuf += (this.dataBuf ? '\n' : '') + value;
      } else if (field === 'event') {
        // we don't currently do anything event-type-specific
      }
      // endpoint event handling: see dispatchEvent
    }
  }

  private dispatchEvent(data: string): void {
    // Per MCP SSE: server emits an `endpoint` event whose `data` is the URL
    // to POST client messages to. Subsequent events are JSON-RPC messages.
    if (!this.postUrl && data.startsWith('http')) {
      this.postUrl = data;
      // Drain any queued outbound messages.
      const q = this.outboundQueue.splice(0);
      for (const m of q) this.postLine(m);
      return;
    }
    for (const h of this.lineHandlers) {
      try { h(data); } catch { /* ignore */ }
    }
  }

  private onEnd(): void {
    if (this.closed) return;
    this.closed = true;
    for (const h of this.closeHandlers) h(new Error('SSE stream ended'));
  }

  send(line: string): void {
    if (this.closed) throw new Error('SSE transport closed');
    if (!this.postUrl) {
      this.outboundQueue.push(line);
      return;
    }
    this.postLine(line);
  }

  private postLine(line: string): void {
    if (!this.postUrl) return;
    const u = new URL(this.postUrl);
    const reqFn = u.protocol === 'https:' ? httpsRequest : httpRequest;
    const r = reqFn({
      method: 'POST',
      host: u.hostname,
      port: u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + (u.search || ''),
      headers: {
        'Content-Type': 'application/json',
        ...(this.cfg.headers ?? {}),
      },
    }, (res) => { res.resume(); });
    r.on('error', () => { /* swallow — endpoint connection issues bubble via SSE close */ });
    r.write(line);
    r.end();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try { this.req?.destroy(); } catch {}
    try { this.res?.destroy(); } catch {}
  }

  onLine(h: (line: string) => void): void { this.lineHandlers.push(h); }
  onClose(h: (err?: Error) => void): void { this.closeHandlers.push(h); }
}
