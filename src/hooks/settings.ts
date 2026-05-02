// Loads and merges hook settings from `~/.deepseek/settings.json` (user)
// and `<cwd>/.deepseek/settings.json` (project). Project hooks require a
// trust ceremony — entries are loaded but disabled until the project is
// trusted via `/hooks trust`.

import { promises as fs } from 'node:fs';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CONFIG_DIR } from '../config/index.js';
import type { HookSpec } from './types.js';

const TRUSTED_FILE = join(CONFIG_DIR, 'trusted-projects.json');

interface CacheEntry {
  hooks: HookSpec[];
  trusted: boolean;
  userMtime: number;
  projectMtime: number;
  trustedMtime: number;
}

const cache = new Map<string, CacheEntry>();

function userSettingsPath(): string {
  return join(homedir(), '.deepseek', 'settings.json');
}

function projectSettingsPath(cwd: string): string {
  return join(cwd, '.deepseek', 'settings.json');
}

function safeMtime(fp: string): number {
  try { return statSync(fp).mtimeMs; } catch { return 0; }
}

async function readJson(fp: string): Promise<any | null> {
  if (!existsSync(fp)) return null;
  try {
    const raw = await fs.readFile(fp, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`[hooks] failed to read ${fp}: ${(e as Error).message}`);
    return null;
  }
}

function parseHooksArray(raw: any, source: 'user' | 'project'): HookSpec[] {
  if (!raw || !Array.isArray(raw.hooks)) return [];
  const out: HookSpec[] = [];
  for (const h of raw.hooks) {
    if (!h || typeof h !== 'object') continue;
    const event = h.event;
    if (event !== 'UserPromptSubmit' && event !== 'PreToolUse' && event !== 'PostToolUse' && event !== 'Stop') {
      console.warn(`[hooks] skipping entry with unknown event: ${JSON.stringify(event)}`);
      continue;
    }
    const command = typeof h.command === 'string' ? h.command : '';
    if (!command) {
      console.warn('[hooks] skipping entry without command');
      continue;
    }
    out.push({
      event,
      matcher: typeof h.matcher === 'string' ? h.matcher : undefined,
      command,
      exit_blocks_tool: !!h.exit_blocks_tool,
      timeoutMs: typeof h.timeoutMs === 'number' ? h.timeoutMs : undefined,
      source,
      // user hooks are always enabled. Project hooks default disabled until trust.
      enabled: source === 'user',
    });
  }
  return out;
}

export async function loadTrustedProjects(): Promise<Set<string>> {
  if (!existsSync(TRUSTED_FILE)) return new Set();
  try {
    const raw = await fs.readFile(TRUSTED_FILE, 'utf8');
    const j = JSON.parse(raw);
    if (Array.isArray(j?.projects)) return new Set(j.projects.map(String));
    return new Set();
  } catch { return new Set(); }
}

export async function trustProject(cwd: string): Promise<void> {
  const set = await loadTrustedProjects();
  set.add(cwd);
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(TRUSTED_FILE, JSON.stringify({ projects: Array.from(set) }, null, 2), { mode: 0o600 });
}

export async function isProjectTrusted(cwd: string): Promise<boolean> {
  const set = await loadTrustedProjects();
  return set.has(cwd);
}

/**
 * Load hooks from user + project settings.json. Project hooks remain disabled
 * until the project is trusted. User hooks fire first; project after.
 */
export async function loadHooks(cwd: string, force = false): Promise<{ hooks: HookSpec[]; projectTrusted: boolean; projectHasHooks: boolean }> {
  const userFp = userSettingsPath();
  const projFp = projectSettingsPath(cwd);
  const userMt = safeMtime(userFp);
  const projMt = safeMtime(projFp);
  const trustedMt = safeMtime(TRUSTED_FILE);
  if (!force) {
    const c = cache.get(cwd);
    if (c && c.userMtime === userMt && c.projectMtime === projMt && c.trustedMtime === trustedMt) {
      const projectHasHooks = c.hooks.some((h) => h.source === 'project');
      return { hooks: c.hooks, projectTrusted: c.trusted, projectHasHooks };
    }
  }

  const userRaw = await readJson(userFp);
  const projRaw = await readJson(projFp);
  const userHooks = parseHooksArray(userRaw, 'user');
  const projHooks = parseHooksArray(projRaw, 'project');
  const trusted = await isProjectTrusted(cwd);
  if (trusted) {
    for (const h of projHooks) h.enabled = true;
  }
  const merged = [...userHooks, ...projHooks];
  cache.set(cwd, {
    hooks: merged,
    trusted,
    userMtime: userMt,
    projectMtime: projMt,
    trustedMtime: trustedMt,
  });
  return { hooks: merged, projectTrusted: trusted, projectHasHooks: projHooks.length > 0 };
}

export function clearHookCache(cwd?: string) {
  if (cwd) cache.delete(cwd); else cache.clear();
}

export const _paths = { userSettingsPath, projectSettingsPath, TRUSTED_FILE };
