// API client — same-origin relative calls to /api/*.
//
// Auth is handled by the first-party Cloudflare Access session cookie (sent
// automatically for same-origin requests). No X-User-Id header.
//
// Route contract (see worker/src/handler.ts):
//
//   GET    /api/whoami                            signed-in email
//   POST   /api/pdfs                              upload (raw bytes + X-File-* headers)
//   GET    /api/pdfs                              list my PDFs (Document[])
//   GET    /api/pdfs/:fileHash                    stream PDF bytes (application/pdf)
//   DELETE /api/pdfs/:fileHash                    delete PDF + highlights + progress
//   GET    /api/documents/:fileHash/highlights    list highlights
//   POST   /api/documents/:fileHash/highlights    create highlight
//   DELETE /api/highlights/:id?fileHash=          delete highlight
//   PUT    /api/documents/:fileHash/progress       save progress

import type { Document, Highlight, NormalizedRect, Progress } from './types';

/**
 * API base URL. Empty string because call sites already carry the `/api/`
 * prefix, and the SPA is served same-origin from Cloudflare Pages.
 */
const BASE_URL = '';

/** Fields the client sends when creating a highlight (server assigns id/createdAt). */
export interface NewHighlightInput {
  page: number;
  rects: NormalizedRect[];
  text: string;
  color: string;
  note?: string;
}

/** Metadata needed to upload a PDF (headers X-File-Hash/Name/Size). */
export interface UploadMeta {
  fileHash: string;
  fileName: string;
  size: number;
}

function url(path: string): string {
  return `${BASE_URL}${path}`;
}

/**
 * fetch wrapper. Throws on non-2xx responses with the server error message.
 * The Access session cookie is sent automatically (default same-origin behavior).
 */
async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);

  const res = await fetch(url(path), { ...init, headers });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // Non-JSON error body; keep the status-based message.
    }
    throw new Error(message);
  }
  return res;
}

// ---------------------------------------------------------------------------
// PDFs (R2)
// ---------------------------------------------------------------------------

/** List the current user's PDFs (metadata only). */
export async function listPdfs(): Promise<Document[]> {
  const res = await request('/api/pdfs', { method: 'GET' });
  return (await res.json()) as Document[];
}

/**
 * Upload raw PDF bytes. The content hash, name, and size travel as headers; the
 * body is the raw bytes. Returns the stored Document metadata.
 */
export async function uploadPdf(bytes: ArrayBuffer, meta: UploadMeta): Promise<Document> {
  const res = await request('/api/pdfs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/pdf',
      'X-File-Hash': meta.fileHash,
      'X-File-Name': meta.fileName,
      'X-File-Size': String(meta.size),
    },
    body: bytes,
  });
  return (await res.json()) as Document;
}

/** Download a PDF's raw bytes by content hash. */
export async function getPdf(fileHash: string): Promise<ArrayBuffer> {
  const res = await request(`/api/pdfs/${encodeURIComponent(fileHash)}`, { method: 'GET' });
  return await res.arrayBuffer();
}

/** Delete a PDF and cascade its highlights + progress. */
export async function deletePdf(fileHash: string): Promise<void> {
  await request(`/api/pdfs/${encodeURIComponent(fileHash)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Highlights (KV, list-per-doc)
// ---------------------------------------------------------------------------

/** List all highlights for a document. */
export async function listHighlights(fileHash: string): Promise<Highlight[]> {
  const res = await request(
    `/api/documents/${encodeURIComponent(fileHash)}/highlights`,
    { method: 'GET' },
  );
  return (await res.json()) as Highlight[];
}

/** Create a highlight for a document; the server assigns id + createdAt. */
export async function createHighlight(
  fileHash: string,
  hl: NewHighlightInput,
): Promise<Highlight> {
  const res = await request(
    `/api/documents/${encodeURIComponent(fileHash)}/highlights`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(hl),
    },
  );
  return (await res.json()) as Highlight;
}

/** Delete a highlight. fileHash is required (same reason as before). */
export async function deleteHighlight(id: string, fileHash: string): Promise<void> {
  await request(
    `/api/highlights/${encodeURIComponent(id)}?fileHash=${encodeURIComponent(fileHash)}`,
    { method: 'DELETE' },
  );
}

// ---------------------------------------------------------------------------
// Progress (KV)
// ---------------------------------------------------------------------------

/** Save the last-read position for a document. */
export async function saveProgress(fileHash: string, progress: Progress): Promise<Progress> {
  const res = await request(
    `/api/documents/${encodeURIComponent(fileHash)}/progress`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(progress),
    },
  );
  return (await res.json()) as Progress;
}
