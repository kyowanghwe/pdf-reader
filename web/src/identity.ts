// User identity — calls /api/whoami (backed by Cloudflare Access JWT).
//
// In production, the Access session cookie is sent automatically (same-origin).
// In local dev, the dev bypass returns `dev@local`.

export interface UserIdentity {
  email: string;
}

let cached: UserIdentity | null = null;

/** Fetch the signed-in email from the backend. Caches the result. */
export async function getIdentity(): Promise<UserIdentity | null> {
  if (cached) return cached;
  try {
    const res = await fetch('/api/whoami');
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: string };
    if (!data.email) return null;
    cached = { email: data.email };
    return cached;
  } catch {
    return null;
  }
}

/**
 * Cloudflare Access logout URL. Served on the same origin because Access
 * protects the entire Pages site; no team domain needs to be known client-side.
 */
export function getLogoutUrl(): string {
  return '/cdn-cgi/access/logout';
}
