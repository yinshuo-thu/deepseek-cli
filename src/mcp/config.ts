// Loads + merges MCP server config from `~/.deepseek/mcp.json` (user) and
// `<cwd>/.deepseek/mcp.json` (project). Project entries override user on
// name collision.

import { promises as fs, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import type { MCPServerConfig } from './types.js';

export const USER_MCP_FILE = join(homedir(), '.deepseek', 'mcp.json');

export function projectMcpFile(cwd: string): string {
  return join(cwd, '.deepseek', 'mcp.json');
}

async function readJson(fp: string): Promise<any | null> {
  if (!existsSync(fp)) return null;
  try {
    const raw = await fs.readFile(fp, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`[mcp] failed to read ${fp}: ${(e as Error).message}`);
    return null;
  }
}

function normalize(name: string, raw: any): MCPServerConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.transport === 'sse' || (typeof raw.url === 'string' && !raw.command)) {
    if (typeof raw.url !== 'string') return null;
    return {
      transport: 'sse',
      url: raw.url,
      ...(raw.headers ? { headers: raw.headers } : {}),
      enabled: raw.enabled !== false,
      ...(typeof raw.timeoutMs === 'number' ? { timeoutMs: raw.timeoutMs } : {}),
    };
  }
  if (typeof raw.command !== 'string') {
    console.warn(`[mcp] server "${name}" has no command/url — skipping.`);
    return null;
  }
  return {
    transport: 'stdio',
    command: raw.command,
    ...(Array.isArray(raw.args) ? { args: raw.args.map(String) } : {}),
    ...(raw.env && typeof raw.env === 'object' ? { env: raw.env } : {}),
    enabled: raw.enabled !== false,
    ...(typeof raw.timeoutMs === 'number' ? { timeoutMs: raw.timeoutMs } : {}),
  };
}

function parseFile(raw: any): Map<string, MCPServerConfig> {
  const out = new Map<string, MCPServerConfig>();
  if (!raw || typeof raw !== 'object') return out;
  const servers = raw.mcpServers ?? raw.servers ?? raw;
  if (!servers || typeof servers !== 'object') return out;
  for (const [name, val] of Object.entries(servers)) {
    if (name === 'mcpServers' || name === 'servers') continue;
    const cfg = normalize(name, val);
    if (cfg) out.set(name, cfg);
  }
  return out;
}

export async function loadMcpConfig(cwd: string): Promise<Map<string, MCPServerConfig>> {
  const enterprisePath = process.env.DEEPSEEK_ENTERPRISE_MCP ?? '/etc/deepseek/mcp.json';
  const enterpriseRaw = await readJson(enterprisePath);
  const userRaw = await readJson(USER_MCP_FILE);
  const projRaw = await readJson(projectMcpFile(cwd));
  const merged = new Map<string, MCPServerConfig>();
  for (const [k, v] of parseFile(enterpriseRaw)) merged.set(k, v);
  for (const [k, v] of parseFile(userRaw)) merged.set(k, v);
  for (const [k, v] of parseFile(projRaw)) merged.set(k, v);
  return merged;
}

export async function writeProjectStub(cwd: string): Promise<string> {
  const fp = projectMcpFile(cwd);
  if (existsSync(fp)) throw new Error(`already exists: ${fp}`);
  await fs.mkdir(dirname(fp), { recursive: true });
  const stub = {
    mcpServers: {
      // example: {
      //   command: 'npx',
      //   args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      //   enabled: true
      // }
    },
  };
  await fs.writeFile(fp, JSON.stringify(stub, null, 2), 'utf8');
  return fp;
}

export async function upsertProjectServer(cwd: string, name: string, cfg: MCPServerConfig): Promise<string> {
  const fp = projectMcpFile(cwd);
  await fs.mkdir(dirname(fp), { recursive: true });
  let raw: any = {};
  if (existsSync(fp)) {
    try { raw = JSON.parse(await fs.readFile(fp, 'utf8')); } catch { raw = {}; }
  }
  if (!raw.mcpServers || typeof raw.mcpServers !== 'object') raw.mcpServers = {};
  raw.mcpServers[name] = cfg;
  await fs.writeFile(fp, JSON.stringify(raw, null, 2), 'utf8');
  return fp;
}

export async function removeProjectServer(cwd: string, name: string): Promise<boolean> {
  const fp = projectMcpFile(cwd);
  if (!existsSync(fp)) return false;
  let raw: any = {};
  try { raw = JSON.parse(await fs.readFile(fp, 'utf8')); } catch { return false; }
  if (!raw.mcpServers || !(name in raw.mcpServers)) return false;
  delete raw.mcpServers[name];
  await fs.writeFile(fp, JSON.stringify(raw, null, 2), 'utf8');
  return true;
}

export async function setEnabled(cwd: string, name: string, enabled: boolean): Promise<boolean> {
  const fp = projectMcpFile(cwd);
  if (!existsSync(fp)) return false;
  let raw: any = {};
  try { raw = JSON.parse(await fs.readFile(fp, 'utf8')); } catch { return false; }
  if (!raw.mcpServers || !raw.mcpServers[name]) return false;
  raw.mcpServers[name].enabled = enabled;
  await fs.writeFile(fp, JSON.stringify(raw, null, 2), 'utf8');
  return true;
}
