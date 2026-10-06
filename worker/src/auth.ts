// Cloudflare Access (Zero Trust) JWT verification.
//
// Every /api/* request carries a `Cf-Access-Jwt-Assertion` header set by the
// Access session cookie. We verify its RS256 signature against the team's JWKS
// (hand-rolled WebCrypto — no external JOSE dependency), validate the aud/exp/iss
// claims, and derive a key-safe identity from the verified email.
//
// Fail-closed: any uncertainty (missing header, bad signature, wrong aud/iss,
// expired, certs-fetch failure, missing email) results in rejection, never in
// treating the request as authenticated — except the explicit dev bypass.

export interface AuthResult {
  email: string;
  /** Key-safe derivation of the email, used in R2/KV storage keys. */
  identity: string;
}

interface AuthEnv {
  TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  DEV_BYPASS: string;
}

interface JwtHeader {
  alg?: string;
  kid?: string;
}

interface JwtPayload {
  aud?: string | string[];
  exp?: number;
  iss?: string;
  email?: string;
}

/**
 * Deterministic, key-safe derivation of an email. Lowercases, then escapes the
 * two characters that are awkward in R2/KV keys: `@` -> `_at_`, `.` -> `_`.
 * e.g. `User@Example.com` -> `user_at_example_com`.
 */
export function emailToIdentity(email: string): string {
  return email.toLowerCase().replace(/@/g, '_at_').replace(/\./g, '_');
}

function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

function forbidden(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Module-level JWKS cache: kid -> imported CryptoKey. Lives for the lifetime of
// the Worker isolate; isolate recycling provides natural rotation.
const keyCache = new Map<string, CryptoKey>();

/**
 * Resolve the verification key for a kid. On a cache miss, refetch the full
 * JWKS and import every key. If the kid is still absent after a successful
 * refetch, return null (fail-closed). Returns null on fetch failure too.
 */
async function getVerificationKey(
  kid: string,
  teamDomain: string,
): Promise<CryptoKey | null> {
  if (keyCache.has(kid)) return keyCache.get(kid)!;

  let res: Response;
  try {
    res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  } catch (err) {
    console.error('[auth] JWKS fetch failed:', err);
    return null; // fail-closed
  }
  if (!res.ok) {
    console.error('[auth] JWKS fetch non-200:', res.status);
    return null; // fail-closed
  }

  const jwks = (await res.json()) as { keys: (JsonWebKey & { kid?: string })[] };
  for (const jwk of jwks.keys) {
    const k = jwk.kid;
    if (!k) continue;
    try {
      const imported = await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      );
      keyCache.set(k, imported);
    } catch (err) {
      console.error('[auth] JWK import failed for kid', k, err);
    }
  }

  return keyCache.get(kid) ?? null;
}

/** base64url -> Uint8Array. */
function base64UrlToBytes(input: string): Uint8Array {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** base64url -> UTF-8 JSON object. */
function decodeSegment<T>(segment: string): T {
  const bytes = base64UrlToBytes(segment);
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text) as T;
}

/**
 * Verify the Access JWT. Returns an AuthResult on success, or a Response (401
 * for a missing header, 403 for anything invalid) on failure.
 */
export async function verifyAccess(
  request: Request,
  env: AuthEnv,
): Promise<AuthResult | Response> {
  // Dev bypass — local only; defaults off in production (see wrangler.toml).
  if (env.DEV_BYPASS === 'true') {
    return { email: 'dev@local', identity: 'dev_at_local' };
  }

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) {
    return unauthorized('Authentication required');
  }

  const segments = token.split('.');
  if (segments.length !== 3) {
    return forbidden('Invalid token');
  }

  let header: JwtHeader;
  let payload: JwtPayload;
  try {
    header = decodeSegment<JwtHeader>(segments[0]);
    payload = decodeSegment<JwtPayload>(segments[1]);
  } catch {
    return forbidden('Invalid token');
  }

  if (!header.kid) {
    return forbidden('Invalid token');
  }

  const key = await getVerificationKey(header.kid, env.TEAM_DOMAIN);
  if (!key) {
    // Covers kid-missing-after-refetch and JWKS fetch failure (fail-closed).
    return forbidden('Invalid token');
  }

  // Verify signature over `header.payload`.
  const signingInput = new TextEncoder().encode(`${segments[0]}.${segments[1]}`);
  const signature = base64UrlToBytes(segments[2]);
  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      signature,
      signingInput,
    );
  } catch {
    valid = false;
  }
  if (!valid) {
    return forbidden('Invalid token');
  }

  // Validate claims.
  const auds = Array.isArray(payload.aud)
    ? payload.aud
    : payload.aud != null
      ? [payload.aud]
      : [];
  if (!auds.includes(env.ACCESS_AUD)) {
    return forbidden('Invalid audience');
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    return forbidden('Token expired');
  }

  if (payload.iss !== `https://${env.TEAM_DOMAIN}`) {
    return forbidden('Invalid issuer');
  }

  const email = payload.email;
  if (!email) {
    return forbidden('Invalid token: missing email');
  }

  return { email, identity: emailToIdentity(email) };
}
