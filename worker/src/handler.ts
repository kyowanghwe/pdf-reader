/**
 * PDF Reader API handler — serves the whole app's API under /api/*.
 *
 * Served same-origin from Cloudflare Pages via a catch-all Pages Function
 * (functions/api/[[route]].ts), so there is NO CORS here.
 *
 * Storage (keyed by the Access-derived identity, not a client-supplied id):
 *   - R2 (PDF_BUCKET): PDF files, object key `user/<identity>/<fileHash>.pdf`.
 *   - KV  (HL_KV): document metadata, highlights, progress.
 *       doc:<identity>:<fileHash>   -> Document metadata JSON
 *       hl:<identity>:<fileHash>    -> Highlight[] JSON (list-per-doc)
 *       prog:<identity>:<fileHash>  -> Progress JSON
 *
 * Auth: every route (reads AND writes) is gated by Cloudflare Access JWT
 * verification (worker/src/auth.ts). The identity is derived from the verified
 * email claim.
 */

import type { Env } from './env';
import { verifyAccess } from './auth';

interface Document {
  fileHash: string;
  fileName: string;
  title: string;
  size: number;
  lastOpenedAt: number;
  lastHighlightId: string | null;
}

interface NormalizedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Highlight {
  id: string;
  fileHash: string;
  page: number;
  rects: NormalizedRect[];
  text: string;
  color: string;
  note: string;
  createdAt: number;
}

interface Progress {
  fileHash: string;
  lastHighlightId: string | null;
  scrollTop: number;
  page: number;
}

/** Canonical highlight color (single yellow used everywhere). */
const DEFAULT_HIGHLIGHT_COLOR = '#fde047';

// ---------------------------------------------------------------------------
// Helpers (no CORS — the SPA and API are same-origin)
// ---------------------------------------------------------------------------

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

function docKey(identity: string, fileHash: string): string {
  return `doc:${identity}:${fileHash}`;
}

function hlKey(identity: string, fileHash: string): string {
  return `hl:${identity}:${fileHash}`;
}

function progKey(identity: string, fileHash: string): string {
  return `prog:${identity}:${fileHash}`;
}

function r2Key(identity: string, fileHash: string): string {
  return `user/${identity}/${fileHash}.pdf`;
}

// ---------------------------------------------------------------------------
// Entry — auth gate then routing
// ---------------------------------------------------------------------------

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const method = request.method.toUpperCase();

  // Auth gate — runs before routing on every request (reads AND writes).
  const authResult = await verifyAccess(request, env);
  if (authResult instanceof Response) return authResult; // 401 or 403
  const { identity } = authResult;

  const url = new URL(request.url);
  const path = url.pathname;
  const parts = path.split('/').filter(Boolean); // e.g. ['api','pdfs','<hash>']

  try {
    // ---- /api/whoami ----
    if (parts[0] === 'api' && parts[1] === 'whoami' && parts.length === 2) {
      if (method === 'GET') return json({ email: authResult.email }, 200);
    }

    // ---- /api/pdfs ----
    if (parts[0] === 'api' && parts[1] === 'pdfs' && parts.length === 2) {
      if (method === 'POST') return uploadPdf(request, env, identity);
      if (method === 'GET') return listPdfs(env, identity);
    }

    // ---- /api/pdfs/:fileHash ----
    if (parts[0] === 'api' && parts[1] === 'pdfs' && parts.length === 3) {
      const fileHash = decodeURIComponent(parts[2]);
      if (method === 'GET' || method === 'HEAD')
        return getPdf(request, env, identity, fileHash);
      if (method === 'DELETE') return deletePdf(env, identity, fileHash);
    }

    // ---- /api/documents/:fileHash/highlights ----
    if (
      parts[0] === 'api' &&
      parts[1] === 'documents' &&
      parts.length === 4 &&
      parts[3] === 'highlights'
    ) {
      const fileHash = decodeURIComponent(parts[2]);
      if (method === 'GET') return listHighlights(env, identity, fileHash);
      if (method === 'POST') return createHighlight(request, env, identity, fileHash);
    }

    // ---- /api/documents/:fileHash/progress ----
    if (
      parts[0] === 'api' &&
      parts[1] === 'documents' &&
      parts.length === 4 &&
      parts[3] === 'progress'
    ) {
      const fileHash = decodeURIComponent(parts[2]);
      if (method === 'PUT') return saveProgress(request, env, identity, fileHash);
    }

    // ---- /api/highlights/:id ----
    // The PUT route and updateHighlight handler remain for backward
    // compatibility; the frontend no longer calls them (yellow-only, no recolor).
    if (parts[0] === 'api' && parts[1] === 'highlights' && parts.length === 3) {
      const id = decodeURIComponent(parts[2]);
      const fileHash = url.searchParams.get('fileHash');
      if (!fileHash) {
        return json({ error: 'Missing fileHash query param' }, 400);
      }
      if (method === 'PUT') return updateHighlight(request, env, identity, fileHash, id);
      if (method === 'DELETE') return deleteHighlight(env, identity, fileHash, id);
    }

    return json({ error: 'Not found' }, 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return json({ error: message }, 500);
  }
}

// ---------------------------------------------------------------------------
// PDF routes (R2)
// ---------------------------------------------------------------------------

async function uploadPdf(req: Request, env: Env, identity: string): Promise<Response> {
  // X-File-Hash is the browser-sent hex SHA-256; non-empty is the only check
  // (not re-validated server-side).
  const fileHash = req.headers.get('X-File-Hash');
  if (!fileHash) {
    return json({ error: 'Missing X-File-Hash header' }, 400);
  }
  const fileName = req.headers.get('X-File-Name') ?? 'document.pdf';
  const size = Number(req.headers.get('X-File-Size') ?? '0');

  if (!req.body) {
    return json({ error: 'Missing request body' }, 400);
  }

  await env.PDF_BUCKET.put(r2Key(identity, fileHash), req.body);

  const existingRaw = await env.HL_KV.get(docKey(identity, fileHash));
  const existing = existingRaw ? (JSON.parse(existingRaw) as Document) : null;

  const doc: Document = {
    fileHash,
    fileName,
    title: existing?.title ?? fileName,
    size: size || existing?.size || 0,
    lastOpenedAt: Date.now(),
    lastHighlightId: existing?.lastHighlightId ?? null,
  };

  await env.HL_KV.put(docKey(identity, fileHash), JSON.stringify(doc));
  return json(doc, 201);
}

async function listPdfs(env: Env, identity: string): Promise<Response> {
  const prefix = `doc:${identity}:`;
  const docs: Document[] = [];
  let cursor: string | undefined;

  do {
    const result = await env.HL_KV.list({ prefix, cursor });
    for (const key of result.keys) {
      const raw = await env.HL_KV.get(key.name);
      if (raw) docs.push(JSON.parse(raw) as Document);
    }
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);

  return json(docs, 200);
}

/**
 * Parse a single `Range: bytes=start-end` header value against a known total
 * file size. Handles "start-end", "start-" (open end), "-suffix" (last N bytes).
 * Returns null when the range is unsatisfiable, malformed, or multi-range
 * (PDF.js never sends multi-range; reject it cleanly with 416).
 */
function parseRangeHeader(
  header: string,
  total: number,
): { start: number; end: number } | null {
  if (!header.startsWith('bytes=')) return null;
  const spec = header.slice('bytes='.length);
  if (spec.includes(',')) return null; // multi-range: unsupported

  const dashIdx = spec.indexOf('-');
  if (dashIdx === -1) return null;
  const sPart = spec.slice(0, dashIdx);
  const ePart = spec.slice(dashIdx + 1);

  let start: number;
  let end: number;

  if (sPart === '') {
    // Suffix range: bytes=-N -> last N bytes
    const suffix = Number(ePart);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(sPart);
    end = ePart === '' ? total - 1 : Number(ePart);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    end = Math.min(end, total - 1); // clamp to file size
  }

  if (start < 0 || start > end || start >= total) return null;
  return { start, end };
}

/**
 * Serve a PDF's bytes, honoring HTTP Range requests so PDF.js can stream only
 * the slices it needs (first-paint in a fraction of the full-download time).
 *
 * Cache-Control choice: `private` because PDFs are gated per-identity by
 * Cloudflare Access and must never be cached by shared/CDN proxies. `max-age=3600`
 * lets the browser reuse already-fetched ranges for an hour (e.g. scrolling back
 * over pages already loaded) without re-hitting the Worker.
 */
async function getPdf(
  req: Request,
  env: Env,
  identity: string,
  fileHash: string,
): Promise<Response> {
  const key = r2Key(identity, fileHash);

  // HEAD: metadata-only response for size pre-discovery.
  if (req.method === 'HEAD') {
    const meta = await env.PDF_BUCKET.head(key);
    if (!meta) return json({ error: 'PDF not found' }, 404);
    return new Response(null, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(meta.size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  }

  const rangeHeader = req.headers.get('Range');

  if (!rangeHeader) {
    // No Range -> full 200. Include Accept-Ranges + Content-Length so the
    // browser and PDF.js know future requests can use range requests.
    const obj = await env.PDF_BUCKET.get(key);
    if (!obj) return json({ error: 'PDF not found' }, 404);
    return new Response(obj.body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(obj.size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  }

  // Range request: HEAD first for total size, then fetch the slice.
  const meta = await env.PDF_BUCKET.head(key);
  if (!meta) return json({ error: 'PDF not found' }, 404);
  const total = meta.size;

  const parsed = parseRangeHeader(rangeHeader, total);
  if (!parsed) {
    // Unsatisfiable / malformed -> 416 with the current size.
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${total}` },
    });
  }

  const { start, end } = parsed;
  const length = end - start + 1; // inclusive range -> byte count

  const obj = await env.PDF_BUCKET.get(key, {
    range: { offset: start, length },
  });
  if (!obj) return json({ error: 'PDF not found' }, 404);

  return new Response(obj.body, {
    status: 206,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': String(length),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

async function deletePdf(env: Env, identity: string, fileHash: string): Promise<Response> {
  await env.PDF_BUCKET.delete(r2Key(identity, fileHash));
  // Cascade: remove metadata, highlights, and progress for this doc.
  await Promise.all([
    env.HL_KV.delete(docKey(identity, fileHash)),
    env.HL_KV.delete(hlKey(identity, fileHash)),
    env.HL_KV.delete(progKey(identity, fileHash)),
  ]);
  return noContent();
}

// ---------------------------------------------------------------------------
// Highlight routes (KV, list-per-doc)
// ---------------------------------------------------------------------------

async function readHighlights(
  env: Env,
  identity: string,
  fileHash: string,
): Promise<Highlight[]> {
  const raw = await env.HL_KV.get(hlKey(identity, fileHash));
  return raw ? (JSON.parse(raw) as Highlight[]) : [];
}

async function writeHighlights(
  env: Env,
  identity: string,
  fileHash: string,
  highlights: Highlight[],
): Promise<void> {
  await env.HL_KV.put(hlKey(identity, fileHash), JSON.stringify(highlights));
}

async function listHighlights(
  env: Env,
  identity: string,
  fileHash: string,
): Promise<Response> {
  const highlights = await readHighlights(env, identity, fileHash);
  return json(highlights, 200);
}

async function createHighlight(
  req: Request,
  env: Env,
  identity: string,
  fileHash: string,
): Promise<Response> {
  const body = (await req.json()) as Partial<Highlight>;
  const highlight: Highlight = {
    id: crypto.randomUUID(),
    fileHash,
    page: body.page ?? 1,
    rects: body.rects ?? [],
    text: body.text ?? '',
    color: body.color ?? DEFAULT_HIGHLIGHT_COLOR,
    note: body.note ?? '',
    createdAt: Date.now(),
  };

  const highlights = await readHighlights(env, identity, fileHash);
  highlights.push(highlight);
  await writeHighlights(env, identity, fileHash, highlights);

  return json(highlight, 201);
}

async function updateHighlight(
  req: Request,
  env: Env,
  identity: string,
  fileHash: string,
  id: string,
): Promise<Response> {
  const body = (await req.json()) as Partial<Pick<Highlight, 'color' | 'note'>>;
  const highlights = await readHighlights(env, identity, fileHash);
  const idx = highlights.findIndex((h) => h.id === id);
  if (idx === -1) {
    return json({ error: 'Highlight not found' }, 404);
  }

  if (body.color !== undefined) highlights[idx].color = body.color;
  if (body.note !== undefined) highlights[idx].note = body.note;

  await writeHighlights(env, identity, fileHash, highlights);
  return json(highlights[idx], 200);
}

async function deleteHighlight(
  env: Env,
  identity: string,
  fileHash: string,
  id: string,
): Promise<Response> {
  const highlights = await readHighlights(env, identity, fileHash);
  const next = highlights.filter((h) => h.id !== id);
  await writeHighlights(env, identity, fileHash, next);
  return noContent();
}

// ---------------------------------------------------------------------------
// Progress route (KV)
// ---------------------------------------------------------------------------

async function saveProgress(
  req: Request,
  env: Env,
  identity: string,
  fileHash: string,
): Promise<Response> {
  const body = (await req.json()) as Partial<Progress>;
  const progress: Progress = {
    fileHash,
    lastHighlightId: body.lastHighlightId ?? null,
    scrollTop: body.scrollTop ?? 0,
    page: body.page ?? 1,
  };

  await env.HL_KV.put(progKey(identity, fileHash), JSON.stringify(progress));

  // Keep the Document's lastHighlightId in sync when provided.
  const docRaw = await env.HL_KV.get(docKey(identity, fileHash));
  if (docRaw) {
    const doc = JSON.parse(docRaw) as Document;
    doc.lastHighlightId = progress.lastHighlightId;
    doc.lastOpenedAt = Date.now();
    await env.HL_KV.put(docKey(identity, fileHash), JSON.stringify(doc));
  }

  return json(progress, 200);
}
