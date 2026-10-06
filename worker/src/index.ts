/**
 * PDF Reader Worker — the single API backing the whole app.
 *
 * Storage:
 *   - R2 (PDF_BUCKET): PDF files, object key `user/<userId>/<fileHash>.pdf`.
 *   - KV  (HL_KV): document metadata, highlights, progress.
 *       doc:<userId>:<fileHash>   -> Document metadata JSON
 *       hl:<userId>:<fileHash>    -> Highlight[] JSON (list-per-doc)
 *       prog:<userId>:<fileHash>  -> Progress JSON
 *
 * Auth: every route requires the `X-User-Id` header (per-browser random uuid).
 * CORS: global headers + OPTIONS 204 preflight.
 */

export interface Env {
  PDF_BUCKET: R2Bucket;
  HL_KV: KVNamespace;
  ALLOWED_ORIGIN: string;
}

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function corsHeaders(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, X-User-Id, X-File-Hash, X-File-Name, X-File-Size',
  };
}

function json(data: unknown, status: number, env: Env): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(env),
    },
  });
}

function noContent(env: Env): Response {
  return new Response(null, { status: 204, headers: corsHeaders(env) });
}

/** Returns the userId from X-User-Id, or null if absent. */
function requireUser(req: Request): string | null {
  const userId = req.headers.get('X-User-Id');
  return userId && userId.trim() !== '' ? userId : null;
}

function docKey(userId: string, fileHash: string): string {
  return `doc:${userId}:${fileHash}`;
}

function hlKey(userId: string, fileHash: string): string {
  return `hl:${userId}:${fileHash}`;
}

function progKey(userId: string, fileHash: string): string {
  return `prog:${userId}:${fileHash}`;
}

function r2Key(userId: string, fileHash: string): string {
  return `user/${userId}/${fileHash}.pdf`;
}

// ---------------------------------------------------------------------------
// Worker entry
// ---------------------------------------------------------------------------

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const method = req.method.toUpperCase();

    // CORS preflight.
    if (method === 'OPTIONS') {
      return noContent(env);
    }

    const userId = requireUser(req);
    if (!userId) {
      return json({ error: 'Missing X-User-Id header' }, 401, env);
    }

    const url = new URL(req.url);
    const path = url.pathname;
    const parts = path.split('/').filter(Boolean); // e.g. ['api','pdfs','<hash>']

    try {
      // ---- /api/pdfs ----
      if (parts[0] === 'api' && parts[1] === 'pdfs' && parts.length === 2) {
        if (method === 'POST') return uploadPdf(req, env, userId);
        if (method === 'GET') return listPdfs(env, userId);
      }

      // ---- /api/pdfs/:fileHash ----
      if (parts[0] === 'api' && parts[1] === 'pdfs' && parts.length === 3) {
        const fileHash = decodeURIComponent(parts[2]);
        if (method === 'GET') return getPdf(env, userId, fileHash);
        if (method === 'DELETE') return deletePdf(env, userId, fileHash);
      }

      // ---- /api/documents/:fileHash/highlights ----
      if (
        parts[0] === 'api' &&
        parts[1] === 'documents' &&
        parts.length === 4 &&
        parts[3] === 'highlights'
      ) {
        const fileHash = decodeURIComponent(parts[2]);
        if (method === 'GET') return listHighlights(env, userId, fileHash);
        if (method === 'POST') return createHighlight(req, env, userId, fileHash);
      }

      // ---- /api/documents/:fileHash/progress ----
      if (
        parts[0] === 'api' &&
        parts[1] === 'documents' &&
        parts.length === 4 &&
        parts[3] === 'progress'
      ) {
        const fileHash = decodeURIComponent(parts[2]);
        if (method === 'PUT') return saveProgress(req, env, userId, fileHash);
      }

      // ---- /api/highlights/:id ----
      if (parts[0] === 'api' && parts[1] === 'highlights' && parts.length === 3) {
        const id = decodeURIComponent(parts[2]);
        const fileHash = url.searchParams.get('fileHash');
        if (!fileHash) {
          return json({ error: 'Missing fileHash query param' }, 400, env);
        }
        if (method === 'PUT') return updateHighlight(req, env, userId, fileHash, id);
        if (method === 'DELETE') return deleteHighlight(env, userId, fileHash, id);
      }

      return json({ error: 'Not found' }, 404, env);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error';
      return json({ error: message }, 500, env);
    }
  },
} satisfies ExportedHandler<Env>;

// ---------------------------------------------------------------------------
// PDF routes (R2)
// ---------------------------------------------------------------------------

async function uploadPdf(req: Request, env: Env, userId: string): Promise<Response> {
  const fileHash = req.headers.get('X-File-Hash');
  if (!fileHash) {
    return json({ error: 'Missing X-File-Hash header' }, 400, env);
  }
  const fileName = req.headers.get('X-File-Name') ?? 'document.pdf';
  const size = Number(req.headers.get('X-File-Size') ?? '0');

  if (!req.body) {
    return json({ error: 'Missing request body' }, 400, env);
  }

  await env.PDF_BUCKET.put(r2Key(userId, fileHash), req.body);

  const existingRaw = await env.HL_KV.get(docKey(userId, fileHash));
  const existing = existingRaw ? (JSON.parse(existingRaw) as Document) : null;

  const doc: Document = {
    fileHash,
    fileName,
    title: existing?.title ?? fileName,
    size: size || existing?.size || 0,
    lastOpenedAt: Date.now(),
    lastHighlightId: existing?.lastHighlightId ?? null,
  };

  await env.HL_KV.put(docKey(userId, fileHash), JSON.stringify(doc));
  return json(doc, 201, env);
}

async function listPdfs(env: Env, userId: string): Promise<Response> {
  const prefix = `doc:${userId}:`;
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

  return json(docs, 200, env);
}

async function getPdf(env: Env, userId: string, fileHash: string): Promise<Response> {
  const obj = await env.PDF_BUCKET.get(r2Key(userId, fileHash));
  if (!obj) {
    return json({ error: 'PDF not found' }, 404, env);
  }
  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      ...corsHeaders(env),
    },
  });
}

async function deletePdf(env: Env, userId: string, fileHash: string): Promise<Response> {
  await env.PDF_BUCKET.delete(r2Key(userId, fileHash));
  // Cascade: remove metadata, highlights, and progress for this doc.
  await Promise.all([
    env.HL_KV.delete(docKey(userId, fileHash)),
    env.HL_KV.delete(hlKey(userId, fileHash)),
    env.HL_KV.delete(progKey(userId, fileHash)),
  ]);
  return noContent(env);
}

// ---------------------------------------------------------------------------
// Highlight routes (KV, list-per-doc)
// ---------------------------------------------------------------------------

async function readHighlights(
  env: Env,
  userId: string,
  fileHash: string,
): Promise<Highlight[]> {
  const raw = await env.HL_KV.get(hlKey(userId, fileHash));
  return raw ? (JSON.parse(raw) as Highlight[]) : [];
}

async function writeHighlights(
  env: Env,
  userId: string,
  fileHash: string,
  highlights: Highlight[],
): Promise<void> {
  await env.HL_KV.put(hlKey(userId, fileHash), JSON.stringify(highlights));
}

async function listHighlights(
  env: Env,
  userId: string,
  fileHash: string,
): Promise<Response> {
  const highlights = await readHighlights(env, userId, fileHash);
  return json(highlights, 200, env);
}

async function createHighlight(
  req: Request,
  env: Env,
  userId: string,
  fileHash: string,
): Promise<Response> {
  const body = (await req.json()) as Partial<Highlight>;
  const highlight: Highlight = {
    id: crypto.randomUUID(),
    fileHash,
    page: body.page ?? 1,
    rects: body.rects ?? [],
    text: body.text ?? '',
    color: body.color ?? 'yellow',
    note: body.note ?? '',
    createdAt: Date.now(),
  };

  const highlights = await readHighlights(env, userId, fileHash);
  highlights.push(highlight);
  await writeHighlights(env, userId, fileHash, highlights);

  return json(highlight, 201, env);
}

async function updateHighlight(
  req: Request,
  env: Env,
  userId: string,
  fileHash: string,
  id: string,
): Promise<Response> {
  const body = (await req.json()) as Partial<Pick<Highlight, 'color' | 'note'>>;
  const highlights = await readHighlights(env, userId, fileHash);
  const idx = highlights.findIndex((h) => h.id === id);
  if (idx === -1) {
    return json({ error: 'Highlight not found' }, 404, env);
  }

  if (body.color !== undefined) highlights[idx].color = body.color;
  if (body.note !== undefined) highlights[idx].note = body.note;

  await writeHighlights(env, userId, fileHash, highlights);
  return json(highlights[idx], 200, env);
}

async function deleteHighlight(
  env: Env,
  userId: string,
  fileHash: string,
  id: string,
): Promise<Response> {
  const highlights = await readHighlights(env, userId, fileHash);
  const next = highlights.filter((h) => h.id !== id);
  await writeHighlights(env, userId, fileHash, next);
  return noContent(env);
}

// ---------------------------------------------------------------------------
// Progress route (KV)
// ---------------------------------------------------------------------------

async function saveProgress(
  req: Request,
  env: Env,
  userId: string,
  fileHash: string,
): Promise<Response> {
  const body = (await req.json()) as Partial<Progress>;
  const progress: Progress = {
    fileHash,
    lastHighlightId: body.lastHighlightId ?? null,
    scrollTop: body.scrollTop ?? 0,
    page: body.page ?? 1,
  };

  await env.HL_KV.put(progKey(userId, fileHash), JSON.stringify(progress));

  // Keep the Document's lastHighlightId in sync when provided.
  const docRaw = await env.HL_KV.get(docKey(userId, fileHash));
  if (docRaw) {
    const doc = JSON.parse(docRaw) as Document;
    doc.lastHighlightId = progress.lastHighlightId;
    doc.lastOpenedAt = Date.now();
    await env.HL_KV.put(docKey(userId, fileHash), JSON.stringify(doc));
  }

  return json(progress, 200, env);
}
