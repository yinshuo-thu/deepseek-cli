// src/config/settings.ts
import { promises as fs, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { HookSpec } from '../hooks/types.js';
import type { PermissionMode } from './index.js';

export interface SettingsLayer {
  hooks?: HookSpec[];
  permissionMode?: PermissionMode;
  [k: string]: unknown;
}

export interface MergedSettings extends SettingsLayer {
  _sources: string[];
}

// enterprise: /etc/deepseek/settings.json OR env DEEPSEEK_ENTERPRISE_CONFIG
// user:       ~/.deepseek/settings.json
// project:    <cwd>/.deepseek/settings.json
// local:      <cwd>/.deepseek/settings.local.json  (gitignored)
export function settingsPaths(cwd: string): { label: string; path: string }[] {
  const enterprise = process.env.DEEPSEEK_ENTERPRISE_CONFIG ?? '/etc/deepseek/settings.json';
  return [
    { label: 'enterprise', path: enterprise },
    { label: 'user', path: join(homedir(), '.deepseek', 'settings.json') },
    { label: 'project', path: join(cwd, '.deepseek', 'settings.json') },
    { label: 'local', path: join(cwd, '.deepseek', 'settings.local.json') },
  ];
}

async function safeRead(fp: string): Promise<SettingsLayer | null> {
  if (!existsSync(fp)) return null;
  try {
    const raw = await fs.readFile(fp, 'utf8');
    return JSON.parse(raw) as SettingsLayer;
  } catch (e) {
    console.warn(`[settings] skipping malformed ${fp}: ${(e as Error).message}`);
    return null;
  }
}

// Cache by cwd. Key = JSON of all mtimes.
const cache = new Map<string, { key: string; result: MergedSettings }>();

export async function loadSettings(cwd: string, force = false): Promise<MergedSettings> {
  const paths = settingsPaths(cwd);
  const mtimes = paths.map((p) => { try { return statSync(p.path).mtimeMs; } catch { return 0; } });
  const cacheKey = mtimes.join(',');
  if (!force) {
    const c = cache.get(cwd);
    if (c && c.key === cacheKey) return c.result;
  }
  const merged: MergedSettings = { _sources: [] };
  for (let i = 0; i < paths.length; i++) {
    const layer = await safeRead(paths[i]!.path);
    if (!layer) continue;
    merged._sources.push(paths[i]!.label);
    for (const [k, v] of Object.entries(layer)) {
      if (k === '_sources') continue;
      (merged as any)[k] = v;
    }
  }
  cache.set(cwd, { key: cacheKey, result: merged });
  return merged;
}

export function clearSettingsCache(cwd?: string) {
  if (cwd) cache.delete(cwd); else cache.clear();
}
