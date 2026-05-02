// Scans `<cwd>/.deepseek/skills/*/SKILL.md` (project) and
// `~/.deepseek/skills/*/SKILL.md` (user). mtime-based cache.

import { promises as fs, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseFrontmatter, asList } from '../utils/frontmatter.js';
import type { SkillDefinition } from './types.js';

interface CacheEntry {
  defs: SkillDefinition[];
  mtimes: Map<string, number>;
}

const cache = new Map<string, CacheEntry>();

export function projectSkillsDir(cwd: string): string {
  return join(cwd, '.deepseek', 'skills');
}

export function userSkillsDir(): string {
  return join(homedir(), '.deepseek', 'skills');
}

function safeMtime(fp: string): number {
  try { return statSync(fp).mtimeMs; } catch { return 0; }
}

async function listSkillDirs(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  let entries: string[] = [];
  try { entries = await fs.readdir(root); } catch { return []; }
  const out: string[] = [];
  for (const e of entries) {
    const dir = join(root, e);
    try {
      const st = statSync(dir);
      if (st.isDirectory() && existsSync(join(dir, 'SKILL.md'))) out.push(dir);
    } catch { /* skip */ }
  }
  return out;
}

async function loadOne(fp: string, source: 'project' | 'user'): Promise<SkillDefinition | null> {
  let raw = '';
  try { raw = await fs.readFile(fp, 'utf8'); } catch { return null; }
  const parsed = parseFrontmatter(raw);
  if (!parsed) {
    console.warn(`[skills] failed to parse ${fp}`);
    return null;
  }
  const obj = parsed.data;
  const name = String(obj.name ?? '').trim();
  if (!name) return null;
  const description = String(obj.description ?? '').trim();
  const triggers = asList(obj.trigger ?? obj.triggers) ?? [];
  const allowedTools = asList(obj['allowed-tools'] ?? obj.allowedTools);
  return {
    name,
    description,
    triggers,
    allowedTools,
    body: parsed.body,
    source,
    filePath: fp,
    mtimeMs: safeMtime(fp),
  };
}

async function loadFrom(root: string, source: 'project' | 'user', mtimes: Map<string, number>): Promise<SkillDefinition[]> {
  const dirs = await listSkillDirs(root);
  const out: SkillDefinition[] = [];
  for (const d of dirs) {
    const fp = join(d, 'SKILL.md');
    mtimes.set(fp, safeMtime(fp));
    const def = await loadOne(fp, source);
    if (def) out.push(def);
  }
  return out;
}

export async function loadSkills(cwd: string, force = false): Promise<SkillDefinition[]> {
  if (!force) {
    const c = cache.get(cwd);
    if (c) {
      // mtime sanity check
      let dirty = false;
      const projDirs = await listSkillDirs(projectSkillsDir(cwd));
      const userDirs = await listSkillDirs(userSkillsDir());
      const all = [...projDirs.map((d) => join(d, 'SKILL.md')), ...userDirs.map((d) => join(d, 'SKILL.md'))];
      if (all.length !== c.mtimes.size) dirty = true;
      else {
        for (const fp of all) {
          if (c.mtimes.get(fp) !== safeMtime(fp)) { dirty = true; break; }
        }
      }
      if (!dirty) return c.defs;
    }
  }

  const mtimes = new Map<string, number>();
  const project = await loadFrom(projectSkillsDir(cwd), 'project', mtimes);
  const user = await loadFrom(userSkillsDir(), 'user', mtimes);
  // Project wins on name collision.
  const byName = new Map<string, SkillDefinition>();
  for (const d of user) byName.set(d.name, d);
  for (const d of project) byName.set(d.name, d);
  const merged = Array.from(byName.values());
  cache.set(cwd, { defs: merged, mtimes });
  return merged;
}

export function clearSkillCache(cwd?: string) {
  if (cwd) cache.delete(cwd); else cache.clear();
}

export async function reloadSkills(cwd: string): Promise<{ added: string[]; removed: string[]; changed: string[]; defs: SkillDefinition[] }> {
  const before = cache.get(cwd)?.defs ?? [];
  clearSkillCache(cwd);
  const after = await loadSkills(cwd, true);
  const beforeMap = new Map(before.map((d) => [d.name, d]));
  const afterMap = new Map(after.map((d) => [d.name, d]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [n, d] of afterMap) {
    if (!beforeMap.has(n)) added.push(n);
    else if (beforeMap.get(n)!.body !== d.body) changed.push(n);
  }
  for (const n of beforeMap.keys()) if (!afterMap.has(n)) removed.push(n);
  return { added, removed, changed, defs: after };
}
