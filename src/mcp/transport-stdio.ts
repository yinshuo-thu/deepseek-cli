// Stdio transport for MCP. Spawns a child process and pipes stdout to the
// JSON-RPC framer, stdin for outbound messages.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { MCPStdioConfig, MCPTransport } from './types.js';

export class StdioTransport implements MCPTransport {
  private child?: ChildProcessWithoutNullStreams;
  private buf = '';
  private lineHandlers: Array<(line: string) => void> = [];
  private closeHandlers: Array<(err?: Error) => void> = [];
  private closed = false;

  constructor(private cfg: MCPStdioConfig, private cwd: string) {}

  async start(): Promise<void> {
    const env = { ...process.env, ...(this.cfg.env ?? {}) };
    const child = spawn(this.cfg.command, this.cfg.args ?? [], {
      cwd: this.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      this.buf += chunk;
      let idx: number;
      while ((idx = this.buf.indexOf('\n')) >= 0) {
        const ln = this.buf.slice(0, idx).replace(/\r$/, '');
        this.buf = this.buf.slice(idx + 1);
        if (ln.trim()) {
          for (const h of this.lineHandlers) {
            try { h(ln); } catch { /* ignore */ }
          }
        }
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', () => {/* discarded — most servers log diagnostics here */});

    child.on('close', (code, sig) => {
      if (this.closed) return;
      this.closed = true;
      const err = code === 0 ? undefined : new Error(`mcp child exited code=${code} signal=${sig ?? ''}`);
      for (const h of this.closeHandlers) h(err);
    });
    child.on('error', (err) => {
      if (this.closed) return;
      this.closed = true;
      for (const h of this.closeHandlers) h(err);
    });
  }

  send(line: string): void {
    if (!this.child || this.closed) throw new Error('mcp transport not connected');
    this.child.stdin.write(line);
  }

  async close(): Promise<void> {
    if (!this.child) return;
    if (this.closed) return;
    this.closed = true;
    try {
      this.child.stdin.end();
    } catch { /* ignore */ }
    try {
      this.child.kill('SIGTERM');
    } catch { /* ignore */ }
  }

  onLine(h: (line: string) => void): void { this.lineHandlers.push(h); }
  onClose(h: (err?: Error) => void): void { this.closeHandlers.push(h); }
}
