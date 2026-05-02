#!/usr/bin/env node
// MCP smoke. Spawns the inline echo MCP server via stdio, runs the full
// MCPClient handshake, calls echo, verifies result text.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MCPClient } from '../src/mcp/client.js';
import { mcpRegistry } from '../src/mcp/registry.js';
import { allTools } from '../src/tools/index.js';
import type { ToolContext } from '../src/tools/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixture = resolve(join(__dirname, 'fixtures', 'mcp-echo-server.mjs'));

console.log('[1] direct MCPClient over stdio');
const client = new MCPClient('echo', { transport: 'stdio', command: process.execPath, args: [fixture], enabled: true }, process.cwd());
await client.connect();
if (client.status !== 'ready') { console.error(`! status=${client.status}`); process.exit(2); }
if (client.tools.length !== 1) { console.error(`! expected 1 tool, got ${client.tools.length}`); process.exit(3); }
if (client.tools[0]!.name !== 'echo') { console.error(`! tool name=${client.tools[0]!.name}`); process.exit(4); }
console.log(`  ok — tools=${client.tools.map((t) => t.name).join(',')}`);

console.log('[2] callTool echo');
const r = await client.callTool('echo', { message: 'hello mcp' });
const text = (r.content || []).map((c: any) => c.text ?? '').join('');
if (!text.includes('echo: hello mcp')) { console.error(`! unexpected echo result: ${JSON.stringify(r)}`); process.exit(5); }
console.log(`  ok — result="${text}"`);
await client.close();

console.log('[3] registry-mediated discovery');
// Use a temp cwd with a project mcp.json fixture pointing at the echo server.
import { promises as fs, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
const tmp = join(tmpdir(), `ds-smoke-mcp-${Date.now().toString(36)}`);
mkdirSync(join(tmp, '.deepseek'), { recursive: true });
await fs.writeFile(join(tmp, '.deepseek', 'mcp.json'), JSON.stringify({
  mcpServers: {
    echo: { command: process.execPath, args: [fixture], enabled: true },
  },
}, null, 2));

await mcpRegistry.connectAll(tmp);
// Wait until the registry sees the tool (handshake is async).
const start = Date.now();
let mcpTools = mcpRegistry.tools();
while (mcpTools.length === 0 && Date.now() - start < 5000) {
  await new Promise((r) => setTimeout(r, 100));
  mcpTools = mcpRegistry.tools();
}
if (mcpTools.length !== 1) { console.error(`! registry expected 1 tool, got ${mcpTools.length}`); process.exit(6); }
const reg = mcpTools[0]!;
if (reg.definition.function.name !== 'mcp_echo_echo') { console.error(`! unexpected tool name ${reg.definition.function.name}`); process.exit(7); }
console.log(`  ok — registry tool name=${reg.definition.function.name}`);

console.log('[4] allTools() merges built-ins + MCP');
const merged = allTools();
if (!merged.find((t) => t.definition.function.name === 'mcp_echo_echo')) { console.error('! merged list missing mcp tool'); process.exit(8); }
if (!merged.find((t) => t.definition.function.name === 'Read')) { console.error('! merged list missing built-in Read'); process.exit(9); }
console.log(`  ok — merged tool count=${merged.length}`);

console.log('[5] Tool.run via the adapter');
const ctx: ToolContext = {
  cwd: tmp,
  log: () => {},
  async requestPermission() { return 'always'; },
};
const tr = await reg.run({ message: 'via adapter' }, ctx);
if (!tr.ok) { console.error(`! adapter run failed: ${tr.content}`); process.exit(10); }
if (!tr.content.includes('echo: via adapter')) { console.error(`! adapter content: ${tr.content}`); process.exit(11); }
console.log(`  ok — adapter result="${tr.content}"`);

// Cleanup connections.
await mcpRegistry.reload(process.cwd());

console.log('— smoke:mcp ok');
process.exit(0);
