import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const CONFIG_DIR = join(homedir(), '.deepseek');
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
export const PROJECTS_DIR = join(CONFIG_DIR, 'projects');

/** Subagent fork-bomb / runaway guards. */
export const MAX_AGENT_DEPTH = 5;
export const MAX_CONCURRENT_AGENTS = 8;

export type ModelId = 'deepseek-v4-flash' | 'deepseek-v4-pro';

/**
 * Permission tier for the current turn-chain.
 *  - plan        : read-only investigation; Write/Edit/Bash refuse to run.
 *  - acceptEdits : allows Read/Write/Edit but blocks Bash/shell execution.
 *  - agent       : standard. Sensitive tools prompt for permission.
 *  - yolo        : auto-approve all tools. For trusted repos only.
 *  - default     : alias for 'agent' (settings-hierarchy compat).
 */
export type PermissionMode = 'plan' | 'acceptEdits' | 'agent' | 'yolo' | 'default';

export type ReasoningEffort = 'off' | 'high' | 'max';

export interface Config {
  apiKey?: string;
  baseUrl: string;
  model: ModelId;
  theme: 'dark' | 'light';
  telemetry: boolean;
  // Set to "anthropic" to use the /anthropic-prefixed endpoint.
  // "deepseek-web" routes through a local proxy backed by a DeepSeek web session cookie.
  apiFlavor: 'openai' | 'anthropic' | 'deepseek-web';
  permissionMode: PermissionMode;
  reasoningEffort: ReasoningEffort;
}

export const DEFAULTS: Config = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  theme: 'dark',
  telemetry: false,
  apiFlavor: 'openai',
  permissionMode: 'agent',
  reasoningEffort: 'off',
};

export async function loadConfig(): Promise<Config> {
  // Env wins over file for apiKey so users can avoid persisting.
  const envKey = process.env.DEEPSEEK_API_KEY;

  if (!existsSync(CONFIG_FILE)) {
    return { ...DEFAULTS, ...(envKey ? { apiKey: envKey } : {}) };
  }

  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Config>;
    return { ...DEFAULTS, ...parsed, ...(envKey ? { apiKey: envKey } : {}) };
  } catch {
    return { ...DEFAULTS, ...(envKey ? { apiKey: envKey } : {}) };
  }
}

export async function saveConfig(cfg: Partial<Config>): Promise<Config> {
  const current = await loadConfig();
  const next: Config = { ...current, ...cfg };
  // Don't persist the env-injected apiKey if it didn't come from the file.
  const persistable: Partial<Config> = { ...next };
  if (process.env.DEEPSEEK_API_KEY && persistable.apiKey === process.env.DEEPSEEK_API_KEY) {
    delete persistable.apiKey;
  }
  await fs.mkdir(dirname(CONFIG_FILE), { recursive: true, mode: 0o700 });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(persistable, null, 2), { mode: 0o600 });
  return next;
}

// Per-project working directory hash → stable namespace for sessions/permissions.
export function projectKey(cwd: string): string {
  // No need for crypto — short stable slug is enough.
  let hash = 0;
  for (let i = 0; i < cwd.length; i++) {
    hash = (hash * 31 + cwd.charCodeAt(i)) | 0;
  }
  const slug = cwd.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(-40);
  return `${slug}-${(hash >>> 0).toString(16)}`;
}

export function projectDir(cwd: string): string {
  return join(PROJECTS_DIR, projectKey(cwd));
}

export function redact(s: string | undefined): string {
  if (!s) return '<unset>';
  if (s.length <= 8) return '••••';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}
