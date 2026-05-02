// MCPClient: handshake `initialize` → `notifications/initialized` → `tools/list`.
// Exposes `callTool(name, args, signal)` and a `status` field. Reconnects with
// exponential backoff (1s, 2s, 4s, max 30s).

import { JsonRpcEndpoint } from './jsonrpc.js';
import { StdioTransport } from './transport-stdio.js';
import { SseTransport } from './transport-sse.js';
import type { MCPCallResult, MCPClientStatus, MCPServerConfig, MCPToolSchema, MCPTransport } from './types.js';

const PROTOCOL_VERSION = '2024-11-05';
const CLIENT_INFO = { name: 'deepseek-cli', version: '0.1.0' };
const HANDSHAKE_TIMEOUT = 10_000;
const TOOL_CALL_TIMEOUT = 60_000;

export class MCPClient {
  status: MCPClientStatus = 'connecting';
  tools: MCPToolSchema[] = [];
  lastError?: string;
  private transport?: MCPTransport;
  private rpc?: JsonRpcEndpoint;
  private backoff = 1000;
  private reconnectTimer?: NodeJS.Timeout;
  private closed = false;

  constructor(public serverName: string, private cfg: MCPServerConfig, private cwd: string) {}

  async connect(): Promise<void> {
    if (this.cfg.enabled === false) {
      this.status = 'disabled';
      return;
    }
    this.status = 'connecting';
    try {
      this.transport = this.makeTransport();
      this.rpc = new JsonRpcEndpoint(this.transport);
      this.transport.onClose((err) => this.onTransportClose(err));
      await this.transport.start();
      // initialize
      await this.rpc.call('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        clientInfo: CLIENT_INFO,
      }, { timeoutMs: HANDSHAKE_TIMEOUT });
      this.rpc.notify('notifications/initialized', {});
      // tools/list
      const listed = await this.rpc.call<{ tools: MCPToolSchema[] }>('tools/list', {}, { timeoutMs: HANDSHAKE_TIMEOUT });
      this.tools = (listed?.tools ?? []).filter(Boolean);
      this.status = 'ready';
      this.backoff = 1000;
    } catch (e) {
      this.lastError = (e as Error).message;
      this.status = 'failed';
      try { await this.transport?.close(); } catch {}
      throw e;
    }
  }

  private makeTransport(): MCPTransport {
    if (this.cfg.transport === 'sse') {
      return new SseTransport(this.cfg);
    }
    return new StdioTransport(this.cfg, this.cwd);
  }

  private onTransportClose(_err?: Error): void {
    if (this.closed) return;
    if (this.status === 'failed' || this.status === 'disabled') return;
    this.status = 'reconnecting';
    const delay = Math.min(this.backoff, 30_000);
    this.backoff = Math.min(this.backoff * 2, 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => { /* status set by connect() */ });
    }, delay);
  }

  async callTool(name: string, args: unknown, signal?: AbortSignal): Promise<MCPCallResult> {
    if (this.status !== 'ready' || !this.rpc) throw new Error(`MCP server ${this.serverName} is ${this.status}`);
    const opts: { timeoutMs: number; signal?: AbortSignal } = { timeoutMs: this.cfg.timeoutMs ?? TOOL_CALL_TIMEOUT };
    if (signal) opts.signal = signal;
    const r = await this.rpc.call<MCPCallResult>('tools/call', { name, arguments: args ?? {} }, opts);
    return r;
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try { await this.transport?.close(); } catch {}
    this.status = 'disabled';
  }
}
