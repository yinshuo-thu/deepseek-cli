// Persistence for the DeepSeek-web session cookie.
//
// keytar is preferred but optional: we try to dynamic-import it, and if it
// fails (Linux without libsecret, or simply not installed) we fall back to
// `~/.deepseek/session.json` written with chmod 600. For M2.0 the file
// fallback is the v1 default — we don't add keytar to dependencies yet.
//
// TODO(M2.x): wire keytar via optional dependency and prefer it when present.

import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { CONFIG_DIR } from '../config/index.js';

export interface WebSession {
  /** The full Cookie header the user pasted from devtools. */
  cookie: string;
  /** Stable user identifier returned by validateCookie. */
  userId: string;
  /** Optional human-readable email if validate ever surfaces one. */
  email?: string;
  /** Unix ms timestamp the session was persisted. */
  createdAt: number;
  /**
   * Optional cached chat_session_id from the most recent successful create.
   * M2.1a does not reuse this across turns (Option A — stateless re-prompt),
   * but the field is reserved for M2.1b's history-cache strategy.
   */
  chatSessionId?: string;
  /**
   * Unix ms of the last successful `validateCookie` round-trip. Used by the
   * boot path to decide whether to re-validate before the first user
   * message; not load-bearing for streaming.
   */
  lastValidatedAt?: number;
}

const SESSION_FILE = join(CONFIG_DIR, 'session.json');
const KEYTAR_SERVICE = 'deepseek-cli';
const KEYTAR_ACCOUNT = 'web-session';

// Keytar is loaded lazily; if the import fails we cache `null` and never retry.
type KeytarLike = {
  getPassword: (service: string, account: string) => Promise<string | null>;
  setPassword: (service: string, account: string, value: string) => Promise<void>;
  deletePassword: (service: string, account: string) => Promise<boolean>;
};
let keytarCache: KeytarLike | null | undefined;
let keytarFallbackWarned = false;

async function tryLoadKeytar(): Promise<KeytarLike | null> {
  if (keytarCache !== undefined) return keytarCache;
  try {
    // TODO(M2.x): add keytar as an optional dep and remove this dynamic dance.
    const mod: any = await import('keytar' as any);
    const k: KeytarLike = mod?.default ?? mod;
    if (k && typeof k.getPassword === 'function') {
      keytarCache = k;
      return k;
    }
  } catch {
    // soft-fail; fall back to file
  }
  keytarCache = null;
  if (!keytarFallbackWarned) {
    keytarFallbackWarned = true;
    console.warn('keytar unavailable; storing session in ~/.deepseek/session.json');
  }
  return null;
}

export async function loadSession(): Promise<WebSession | null> {
  const keytar = await tryLoadKeytar();
  if (keytar) {
    try {
      const raw = await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
      if (raw) return JSON.parse(raw) as WebSession;
    } catch {
      // fall through to file
    }
  }
  if (!existsSync(SESSION_FILE)) return null;
  try {
    const raw = await fs.readFile(SESSION_FILE, 'utf8');
    return JSON.parse(raw) as WebSession;
  } catch {
    return null;
  }
}

export async function saveSession(s: WebSession): Promise<void> {
  const keytar = await tryLoadKeytar();
  if (keytar) {
    try {
      await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, JSON.stringify(s));
      return;
    } catch {
      // fall through to file
    }
  }
  await fs.mkdir(dirname(SESSION_FILE), { recursive: true, mode: 0o700 });
  await fs.writeFile(SESSION_FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
}

export async function clearSession(): Promise<void> {
  const keytar = await tryLoadKeytar();
  if (keytar) {
    try {
      await keytar.deletePassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
    } catch {
      // ignore
    }
  }
  if (existsSync(SESSION_FILE)) {
    try {
      await fs.unlink(SESSION_FILE);
    } catch {
      // ignore
    }
  }
}
