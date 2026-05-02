// src/config/permissions.ts
import { promises as fs, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { projectDir } from './index.js';

interface PersistedPermissions {
  always: string[];  // tool names auto-approved for this project
}

export function permissionsFile(cwd: string): string {
  return join(projectDir(cwd), 'permissions.json');
}

export async function loadPersistedPermissions(cwd: string): Promise<Set<string>> {
  const fp = permissionsFile(cwd);
  if (!existsSync(fp)) return new Set();
  try {
    const raw = await fs.readFile(fp, 'utf8');
    const j = JSON.parse(raw) as PersistedPermissions;
    if (Array.isArray(j.always)) return new Set(j.always.map(String));
    return new Set();
  } catch { return new Set(); }
}

export async function persistPermission(cwd: string, toolName: string): Promise<void> {
  const existing = await loadPersistedPermissions(cwd);
  existing.add(toolName);
  const fp = permissionsFile(cwd);
  try {
    await fs.mkdir(dirname(fp), { recursive: true });
    await fs.writeFile(fp, JSON.stringify({ always: Array.from(existing) }, null, 2), { mode: 0o600 });
  } catch (e) {
    console.warn(`[permissions] failed to persist: ${(e as Error).message}`);
  }
}

export async function clearPersistedPermissions(cwd: string): Promise<void> {
  const fp = permissionsFile(cwd);
  if (existsSync(fp)) {
    try { await fs.unlink(fp); } catch { /* best-effort */ }
  }
}
