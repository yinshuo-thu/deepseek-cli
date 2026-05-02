// Process-wide singleton MCP registry. Holds the list of MCPClient
// instances and exposes a merged Tool[] surface to the agent loop.

import type { Tool } from '../tools/types.js';
import { setExtraToolsProvider } from '../tools/index.js';
import { loadMcpConfig } from './config.js';
import { MCPClient } from './client.js';
import { makeMcpTool } from './tool-adapter.js';

class MCPRegistry {
  private clients = new Map<string, MCPClient>();
  private toolCache: Tool[] = [];
  private connectingCwd?: string;

  constructor() {
    setExtraToolsProvider(() => this.tools());
  }

  /** Snapshot of all currently-known MCP-derived Tools. */
  tools(): Tool[] {
    return this.toolCache;
  }

  status(): Array<{ name: string; transport: string; status: string; toolCount: number; lastError?: string }> {
    const out: Array<{ name: string; transport: string; status: string; toolCount: number; lastError?: string }> = [];
    for (const [name, c] of this.clients) {
      out.push({
        name,
        transport: (c as any).cfg?.transport === 'sse' ? 'sse' : 'stdio',
        status: c.status,
        toolCount: c.tools.length,
        ...(c.lastError ? { lastError: c.lastError } : {}),
      });
    }
    return out;
  }

  async connectAll(cwd: string): Promise<void> {
    this.connectingCwd = cwd;
    const cfg = await loadMcpConfig(cwd);
    // Disconnect any clients that were removed.
    for (const name of [...this.clients.keys()]) {
      if (!cfg.has(name)) {
        try { await this.clients.get(name)!.close(); } catch {}
        this.clients.delete(name);
      }
    }
    // Connect newly added or refreshed.
    for (const [name, serverCfg] of cfg) {
      if (this.clients.has(name)) continue;
      const client = new MCPClient(name, serverCfg, cwd);
      this.clients.set(name, client);
      // Best-effort connect; failures don't block.
      client.connect().then(() => this.refreshTools()).catch(() => this.refreshTools());
    }
    this.refreshTools();
  }

  async reload(cwd?: string): Promise<void> {
    const target = cwd ?? this.connectingCwd ?? process.cwd();
    // Close all and re-init.
    for (const [, c] of this.clients) {
      try { await c.close(); } catch {}
    }
    this.clients.clear();
    await this.connectAll(target);
  }

  enable(name: string): boolean {
    const c = this.clients.get(name);
    if (!c) return false;
    if (c.status === 'disabled') {
      // Allow user to re-enable a disabled client by re-connecting.
      c.connect().then(() => this.refreshTools()).catch(() => this.refreshTools());
    }
    return true;
  }

  async disable(name: string): Promise<boolean> {
    const c = this.clients.get(name);
    if (!c) return false;
    await c.close();
    this.refreshTools();
    return true;
  }

  private refreshTools(): void {
    const out: Tool[] = [];
    for (const [, c] of this.clients) {
      if (c.status !== 'ready') continue;
      for (const t of c.tools) out.push(makeMcpTool(c, t));
    }
    this.toolCache = out;
  }
}

export const mcpRegistry = new MCPRegistry();
