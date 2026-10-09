// Load a PDF document with PDF.js, keyed by its content hash.
//
// Loading is URL-based (not a pre-downloaded ArrayBuffer): PDF.js fetches the
// same-origin /api/pdfs/:fileHash endpoint and issues HTTP Range requests
// itself, so only the bytes needed for the visible pages are downloaded. The
// Cloudflare Access session cookie rides along automatically (first-party,
// same-origin — no withCredentials needed).

import { useEffect, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Point PDF.js at the bundled worker (Vite resolves the `?url` import to the
// hashed asset path). Set once at module load.
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

/** 64 KB per range request — balances request count vs. wasted bandwidth. */
const RANGE_CHUNK_SIZE = 65536;

interface PdfDocumentState {
  doc: PDFDocumentProxy | null;
  numPages: number;
  loading: boolean;
  error: Error | null;
}

const IDLE: PdfDocumentState = {
  doc: null,
  numPages: 0,
  loading: false,
  error: null,
};

/**
 * Load the PDF identified by `fileHash` from the same-origin API. Returns the
 * document proxy, page count, and loading/error state. Pass null/'' to reset to
 * the idle state (e.g. when no document is open).
 */
export function usePdfDocument(fileHash: string | null): PdfDocumentState {
  const [state, setState] = useState<PdfDocumentState>(IDLE);

  useEffect(() => {
    if (!fileHash) {
      setState(IDLE);
      return;
    }

    let cancelled = false;
    setState({ doc: null, numPages: 0, loading: true, error: null });

    const task = pdfjsLib.getDocument({
      url: `/api/pdfs/${encodeURIComponent(fileHash)}`,
      // Fetch only what the current page needs; never pre-fetch the whole file.
      disableAutoFetch: true,
      // Enable progressive streaming so the first page can paint early.
      disableStream: false,
      rangeChunkSize: RANGE_CHUNK_SIZE,
    });

    task.promise.then(
      (doc) => {
        if (cancelled) {
          doc.destroy();
          return;
        }
        setState({ doc, numPages: doc.numPages, loading: false, error: null });
      },
      (err: unknown) => {
        if (cancelled) return;
        setState({
          doc: null,
          numPages: 0,
          loading: false,
          error: err instanceof Error ? err : new Error('Failed to load PDF'),
        });
      },
    );

    return () => {
      cancelled = true;
      task.destroy();
    };
  }, [fileHash]);

  return state;
}
