// Loads & caches subagent definitions from built-ins + `<cwd>/.deepseek/agents/*.md`.
// Hand-rolled frontmatter parser — no new runtime deps.

import { promises as fs } from 'node:fs';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelId, PermissionMode } from '../config/index.js';
import { BUILTIN_AGENTS } from './builtins.js';

export interface AgentDefinition {
  name: string;
  description: string;
  tools: string[] | 'inherit';
  model: 'inherit' | ModelId | 'deepseek-reasoner';
  permissionMode: PermissionMode;
  systemPrompt: string;
  skills?: string[];
  source: 'project' | 'builtin';
  filePath?: string;
}

interface CacheEntry {
  defs: AgentDefinition[];
  // map of filePath → mtime ms
  fileMtimes: Map<string, number>;
}

const cache: Map<string, CacheEntry> = new Map();

export function projectAgentsDir(cwd: string): string {
  return join(cwd, '.deepseek', 'agents');
}

/**
 * Parse a single `---\nkey: value\n...\n---\nbody` markdown file into
 * an AgentDefinition. Returns null on parse error (caller logs warning).
 *
 * Supported frontmatter shape:
 *   key: value
 *   key:
 *     - item1
 *     - item2
 *
 * Quoted strings (single or double) are unwrapped. Booleans/numbers are kept as strings.
 */
export function parseFrontmatter(raw: string, filePath: string): AgentDefinition | null {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const head = m[1] ?? '';
  const body = (m[2] ?? '').trim();

  const obj: Record<string, string | string[]> = {};
  const lines = head.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) { i++; continue; }
    const key = kv[1]!;
    const rest = (kv[2] ?? '').trim();
    if (rest === '') {
      // Possible YAML list on subsequent indented lines.
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const ln = lines[j] ?? '';
        const li = ln.match(/^\s+-\s+(.+)$/);
        if (!li) break;
        items.push(unquote(li[1]!.trim()));
        j++;
      }
      obj[key] = items;
      i = j;
    } else {
      obj[key] = unquote(rest);
      i++;
    }
  }

  const name = String(obj.name ?? '').trim();
  if (!name) return null;
  const description = String(obj.description ?? '').trim();
  const toolsRaw = obj.tools;
  let tools: string[] | 'inherit';
  if (toolsRaw === undefined || toolsRaw === '' || toolsRaw === 'inherit') tools = 'inherit';
  else if (Array.isArray(toolsRaw)) tools = toolsRaw;
  else tools = String(toolsRaw).split(',').map((s) => s.trim()).filter(Boolean);

  const model = (String(obj.model ?? 'inherit').trim() || 'inherit') as AgentDefinition['model'];
  const permissionMode = (String(obj.permissionMode ?? 'agent').trim() as PermissionMode);
  const skills = Array.isArray(obj.skills) ? obj.skills : undefined;

  return {
    name,
    description,
    tools,
    model,
    permissionMode,
    systemPrompt: body,
    skills,
    source: 'project',
    filePath,
  };
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

async function loadProjectAgents(cwd: string): Promise<{ defs: AgentDefinition[]; mtimes: Map<string, number> }> {
  const dir = projectAgentsDir(cwd);
  const mtimes = new Map<string, number>();
  if (!existsSync(dir)) return { defs: [], mtimes };
  let entries: string[] = [];
  try { entries = await fs.readdir(dir); } catch { return { defs: [], mtimes }; }
  const defs: AgentDefinition[] = [];
  for (const f of entries) {
    if (!f.endsWith('.md')) continue;
    const fp = join(dir, f);
    let raw = '';
    try { raw = await fs.readFile(fp, 'utf8'); } catch { continue; }
    try {
      const st = statSync(fp);
      mtimes.set(fp, st.mtimeMs);
    } catch {}
    const def = parseFrontmatter(raw, fp);
    if (!def) {
      console.warn(`[agents] failed to parse ${fp}`);
      continue;
    }
    defs.push(def);
  }
  return { defs, mtimes };
}

/**
 * Resolve all agent definitions, project entries override built-ins by name.
 * Cached per-cwd; mtime check decides whether to reload.
 */
export async function loadAgentDefinitions(cwd: string, force = false): Promise<AgentDefinition[]> {
  if (!force) {
    const cached = cache.get(cwd);
    if (cached) {
      // Check whether any tracked file has changed mtime, or a new .md appeared.
      const dir = projectAgentsDir(cwd);
      let dirty = false;
      if (existsSync(dir)) {
        let entries: string[] = [];
        try { entries = await fs.readdir(dir); } catch { entries = []; }
        const mdFiles = entries.filter((f) => f.endsWith('.md')).map((f) => join(dir, f));
        if (mdFiles.length !== cached.fileMtimes.size) dirty = true;
        else {
          for (const fp of mdFiles) {
            const m = cached.fileMtimes.get(fp);
            try {
              const st = statSync(fp);
              if (m === undefined || st.mtimeMs !== m) { dirty = true; break; }
            } catch { dirty = true; break; }
          }
        }
      } else if (cached.fileMtimes.size > 0) {
        dirty = true;
      }
      if (!dirty) return cached.defs;
    }
  }

  const { defs: project, mtimes } = await loadProjectAgents(cwd);
  // Built-ins first, then project overrides.
  const byName = new Map<string, AgentDefinition>();
  for (const d of BUILTIN_AGENTS) byName.set(d.name, d);
  for (const d of project) byName.set(d.name, d);
  const merged = Array.from(byName.values());
  cache.set(cwd, { defs: merged, fileMtimes: mtimes });
  return merged;
}

export function clearAgentCache(cwd?: string) {
  if (cwd) cache.delete(cwd); else cache.clear();
}

export async function reloadAgentDefinitions(cwd: string): Promise<{ added: string[]; removed: string[]; changed: string[]; defs: AgentDefinition[] }> {
  const before = cache.get(cwd)?.defs ?? [];
  clearAgentCache(cwd);
  const after = await loadAgentDefinitions(cwd, true);
  const beforeMap = new Map(before.map((d) => [d.name, d]));
  const afterMap = new Map(after.map((d) => [d.name, d]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [n, d] of afterMap) {
    if (!beforeMap.has(n)) added.push(n);
    else if (beforeMap.get(n)!.systemPrompt !== d.systemPrompt) changed.push(n);
  }
  for (const n of beforeMap.keys()) if (!afterMap.has(n)) removed.push(n);
  return { added, removed, changed, defs: after };
}
