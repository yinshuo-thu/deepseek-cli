// Cookie validator.
//
// M2.0 stub: any cookie longer than 8 chars is treated as valid and a fake
// userId is derived from its prefix. This lets the full /login UX boot
// without depending on the real DS-web wire format.
//
// TODO(M2.1): replace with real call to https://chat.deepseek.com/api/v0/users/current
// using the user's cookie as the Cookie header. On non-200 or HTML response
// (Cloudflare challenge), return null and surface a hint to the user.

export interface ValidatedSession {
  userId: string;
  email?: string;
}

export async function validateCookie(cookie: string): Promise<ValidatedSession | null> {
  const trimmed = (cookie ?? '').trim();
  if (trimmed.length <= 8) return null;
  return { userId: 'stub-' + trimmed.slice(0, 6) };
}
