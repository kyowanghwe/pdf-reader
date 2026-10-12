// Load a PDF document with PDF.js, keyed by its content hash.
//
// The full PDF is downloaded as an ArrayBuffer first, then passed to PDF.js
// as in-memory data. This avoids HTTP Range request races and makes all
// doc.getPage(n) calls instant (data already in memory), so pageDims loads
// reliably and page jumps work correctly.

import { useEffect, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { getPdf } from '../api';

// Point PDF.js at the bundled worker (Vite resolves the `?url` import to the
// hashed asset path). Set once at module load.
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

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
 * Load the PDF identified by `fileHash` from the same-origin API. Downloads
 * the full file as an ArrayBuffer and passes it to PDF.js so all page data is
 * instantly available in memory. Returns the document proxy, page count, and
 * loading/error state. Pass null/'' to reset to the idle state (e.g. when no
 * document is open).
 */
export function usePdfDocument(fileHash: string | null): PdfDocumentState {
  const [state, setState] = useState<PdfDocumentState>(IDLE);

  useEffect(() => {
    if (!fileHash) {
      setState(IDLE);
      return;
    }

    let cancelled = false;
    // Keep a reference so we can destroy the task if the component unmounts
    // after the ArrayBuffer fetch resolves but before PDF.js finishes parsing.
    let pdfTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;
    setState({ doc: null, numPages: 0, loading: true, error: null });

    (async () => {
      try {
        const arrayBuffer = await getPdf(fileHash);
        if (cancelled) return;

        pdfTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
        const doc = await pdfTask.promise;

        if (cancelled) {
          doc.destroy();
          return;
        }

        setState({ doc, numPages: doc.numPages, loading: false, error: null });
      } catch (err: unknown) {
        if (cancelled) return;
        setState({
          doc: null,
          numPages: 0,
          loading: false,
          error: err instanceof Error ? err : new Error('Failed to load PDF'),
        });
      }
    })();

    return () => {
      cancelled = true;
      pdfTask?.destroy();
    };
  }, [fileHash]);

  return state;
}
