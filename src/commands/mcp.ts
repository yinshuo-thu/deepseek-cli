// Slash command handlers for /mcp.

import { loadMcpConfig, removeProjectServer, setEnabled, upsertProjectServer, writeProjectStub } from '../mcp/config.js';
import { mcpRegistry } from '../mcp/registry.js';

export async function listMcpMarkdown(): Promise<string> {
  const status = mcpRegistry.status();
  if (!status.length) return '*(no MCP servers configured — try `/mcp init` and `/mcp add`)*';
  const lines = ['**MCP servers**', ''];
  lines.push('| name | transport | status | tools |');
  lines.push('|------|-----------|--------|-------|');
  for (const s of status) {
    lines.push(`| ${s.name} | ${s.transport} | ${s.status}${s.lastError ? ` (${s.lastError})` : ''} | ${s.toolCount} |`);
  }
  return lines.join('\n');
}

export async function initMcpMarkdown(cwd: string): Promise<string> {
  try {
    const fp = await writeProjectStub(cwd);
    return `Wrote stub \`${fp}\`. Add servers via \`/mcp add <name> <command-line>\` or by editing the file directly.`;
  } catch (e) {
    return `error: ${(e as Error).message}`;
  }
}

export async function addMcpMarkdown(cwd: string, name: string, commandLine: string): Promise<string> {
  // Parse simple shell-style command line: split on spaces (no quote handling).
  const parts = commandLine.trim().split(/\s+/);
  const command = parts[0];
  const args = parts.slice(1);
  if (!command) return 'error: missing command.';
  try {
    const fp = await upsertProjectServer(cwd, name, {
      transport: 'stdio',
      command,
      args,
      enabled: true,
    });
    await mcpRegistry.reload(cwd);
    return `Added MCP server \`${name}\` → \`${command} ${args.join(' ')}\` (config: \`${fp}\`).`;
  } catch (e) {
    return `error: ${(e as Error).message}`;
  }
}

export async function enableMcpMarkdown(cwd: string, name: string): Promise<string> {
  const cfg = await loadMcpConfig(cwd);
  if (!cfg.has(name)) return `error: no such server \`${name}\`.`;
  await setEnabled(cwd, name, true);
  await mcpRegistry.reload(cwd);
  return `Enabled \`${name}\`.`;
}

export async function disableMcpMarkdown(cwd: string, name: string): Promise<string> {
  const cfg = await loadMcpConfig(cwd);
  if (!cfg.has(name)) return `error: no such server \`${name}\`.`;
  await setEnabled(cwd, name, false);
  await mcpRegistry.disable(name);
  return `Disabled \`${name}\`.`;
}

export async function reloadMcpMarkdown(): Promise<string> {
  await mcpRegistry.reload();
  return `Reloaded MCP servers. ${mcpRegistry.status().length} configured.`;
}

export async function removeMcpMarkdown(cwd: string, name: string): Promise<string> {
  const ok = await removeProjectServer(cwd, name);
  if (!ok) return `error: server \`${name}\` not found in project mcp.json.`;
  await mcpRegistry.reload(cwd);
  return `Removed \`${name}\`.`;
}
