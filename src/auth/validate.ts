// Cookie validator — real DeepSeek-web wire format (M2.1a).
//
// Hits GET https://chat.deepseek.com/api/v0/users/current with the user's
// pasted Cookie header (and a derived Authorization: Bearer header when
// `userToken=...` is extractable from the cookie). Returns a small typed
// shape on success; null on auth failure or upstream error.
//
// Internal `reason` codes (for telemetry only): 'cloudflare' | 'expired'
// | 'network'. They are merged into a single nullish return to keep the
// public contract identical to the M2.0 stub.

import { dsWebHeaders, extractUserToken } from './dswebClient.js';

export interface ValidatedSession {
  userId: string;
  email?: string;
}

export type ValidateFailureReason = 'cloudflare' | 'expired' | 'network';

const VALIDATE_URL = 'https://chat.deepseek.com/api/v0/users/current';
const VALIDATE_TIMEOUT_MS = 10_000;

interface ValidateOutcome {
  ok: boolean;
  session?: ValidatedSession;
  reason?: ValidateFailureReason;
}

export async function validateCookie(cookie: string): Promise<ValidatedSession | null> {
  const result = await validateCookieDetailed(cookie);
  return result.ok && result.session ? result.session : null;
}

/**
 * Detailed validate — exposes the failure reason for telemetry and for the
 * boot-time re-validate path so the UI can show a precise hint
 * ("session expired" vs "Cloudflare challenge"). Public consumers should
 * stick to `validateCookie`.
 */
export async function validateCookieDetailed(cookie: string): Promise<ValidateOutcome> {
  const trimmed = (cookie ?? '').trim();
  if (trimmed.length <= 8) return { ok: false, reason: 'expired' };

  const userToken = extractUserToken(trimmed);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), VALIDATE_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(VALIDATE_URL, {
      method: 'GET',
      headers: dsWebHeaders({ cookie: trimmed, userToken }),
      signal: ac.signal,
      redirect: 'manual',
    });
  } catch {
    clearTimeout(t);
    return { ok: false, reason: 'network' };
  }
  clearTimeout(t);

  // Cloudflare / DDoS-Guard challenge typically returns 403 + cf-mitigated
  // header, or a 200 with HTML body containing "Just a moment".
  const cfHeader = resp.headers.get('cf-mitigated') ?? resp.headers.get('CF-Mitigated');
  if (cfHeader) return { ok: false, reason: 'cloudflare' };

  const ct = (resp.headers.get('content-type') ?? '').toLowerCase();
  if (!ct.includes('application/json')) {
    // Read a peek to disambiguate Cloudflare HTML vs unexpected upstream.
    const peek = (await resp.text().catch(() => '')).slice(0, 1024).toLowerCase();
    // Cloudflare/DDoS-Guard interstitial markers as observed across the
    // varieties of challenge HTML they serve.
    if (peek.includes('just a moment') || peek.includes('cf-chl-challenge') || peek.includes('cf-mitigated') || peek.includes('cloudflare')) {
      return { ok: false, reason: 'cloudflare' };
    }
    return { ok: false, reason: resp.status === 401 || resp.status === 403 ? 'expired' : 'network' };
  }

  if (resp.status === 401 || resp.status === 403) return { ok: false, reason: 'expired' };
  if (resp.status >= 500) return { ok: false, reason: 'network' };

  let body: unknown;
  try {
    body = await resp.json();
  } catch {
    return { ok: false, reason: 'network' };
  }

  const session = parseUsersCurrent(body);
  if (!session) return { ok: false, reason: 'expired' };
  return { ok: true, session };
}

function parseUsersCurrent(raw: unknown): ValidatedSession | null {
  // Expected envelope: {code:0, data:{biz_code:0, biz_data:{user:{id, email}}}}.
  // Be liberal in what we accept — pull the first plausible shape that
  // surfaces a non-empty userId.
  if (!raw || typeof raw !== 'object') return null;
  const top = raw as Record<string, unknown>;
  if (typeof top.code === 'number' && top.code !== 0) return null;
  const data = (top.data ?? top) as Record<string, unknown>;
  if (typeof data.biz_code === 'number' && data.biz_code !== 0) return null;
  const bizData = (data.biz_data ?? data.user ?? data) as Record<string, unknown>;
  const user = (bizData.user ?? bizData) as Record<string, unknown>;
  const idCandidate = user.id ?? user.user_id ?? user.uid ?? bizData.id;
  if (idCandidate == null) return null;
  const userId = String(idCandidate).trim();
  if (!userId) return null;
  const emailRaw = user.email ?? bizData.email;
  const email = typeof emailRaw === 'string' && emailRaw.trim() ? emailRaw.trim() : undefined;
  return { userId, email };
}
