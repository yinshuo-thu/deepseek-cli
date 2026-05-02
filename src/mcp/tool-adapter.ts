// Adapt an MCP tool schema into our internal Tool. Uses `mcp_<server>_<tool>`
// naming. Permission is required for every MCP call (network/code surface
// the user couldn't audit ahead of time).

import type { Tool } from '../tools/types.js';
import type { MCPClient } from './client.js';
import type { MCPToolSchema } from './types.js';

export function makeMcpToolName(server: string, tool: string): string {
  const safeServer = server.replace(/[^A-Za-z0-9_]/g, '_');
  const safeTool = tool.replace(/[^A-Za-z0-9_]/g, '_');
  return `mcp_${safeServer}_${safeTool}`;
}

function summariseArgs(args: any): string {
  if (!args || typeof args !== 'object') return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    const repr = typeof v === 'string' ? (v.length > 60 ? v.slice(0, 60) + '…' : v) : JSON.stringify(v);
    parts.push(`${k}=${repr}`);
    if (parts.join(' ').length > 100) break;
  }
  return parts.join(' ');
}

function normaliseContent(content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>): string {
  const out: string[] = [];
  for (const c of content) {
    if (!c || typeof c !== 'object') continue;
    if (c.type === 'text') out.push(c.text ?? '');
    else if (c.type === 'image') {
      const bytes = typeof c.data === 'string' ? Math.floor((c.data.length * 3) / 4) : 0;
      out.push(`[image: ${c.mimeType ?? 'unknown'}, ${bytes} bytes elided]`);
    } else {
      out.push(`[${c.type}: ${JSON.stringify(c).slice(0, 200)}]`);
    }
  }
  return out.join('\n');
}

export function makeMcpTool(client: MCPClient, schema: MCPToolSchema): Tool {
  const name = makeMcpToolName(client.serverName, schema.name);
  const description = `[MCP:${client.serverName}] ${schema.description ?? schema.name}`;
  const parameters = (schema.inputSchema && typeof schema.inputSchema === 'object')
    ? schema.inputSchema
    : { type: 'object', properties: {} };
  return {
    requiresPermission: true,
    definition: {
      type: 'function',
      function: { name, description, parameters: parameters as Record<string, unknown> },
    },
    async run(args, ctx) {
      const decision = await ctx.requestPermission(name, `MCP: ${client.serverName}.${schema.name} (${summariseArgs(args)})`);
      if (decision === 'deny') return { ok: false, content: 'User denied MCP tool call.' };
      try {
        const r = await client.callTool(schema.name, args, ctx.signal);
        const text = normaliseContent(r.content ?? []);
        return { ok: !r.isError, content: text || '<empty>' };
      } catch (e) {
        return { ok: false, content: `MCP call failed: ${(e as Error).message}` };
      }
    },
  };
}
