import { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { pdfjs } from './pdfSetup';

export interface UsePdfDocumentResult {
  doc: PDFDocumentProxy | null;
  numPages: number;
  error: Error | null;
  loading: boolean;
}

/**
 * Loads a PDF from raw bytes. Pass a stable reference (e.g. memoized ArrayBuffer)
 * to avoid reloading on every render.
 */
export function usePdfDocument(
  data: ArrayBuffer | Uint8Array | null,
): UsePdfDocumentResult {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!data) {
      setDoc(null);
      setNumPages(0);
      setError(null);
      return;
    }

    let cancelled = false;
    // getDocument may transfer/detach the buffer; clone so callers keep their copy.
    const bytes =
      data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
    const task = pdfjs.getDocument({ data: bytes });

    setLoading(true);
    setError(null);

    task.promise.then(
      (loaded) => {
        if (cancelled) {
          loaded.destroy();
          return;
        }
        setDoc(loaded);
        setNumPages(loaded.numPages);
        setLoading(false);
      },
      (err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      },
    );

    return () => {
      cancelled = true;
      task.destroy();
    };
  }, [data]);

  // Destroy the document when it changes or on unmount.
  useEffect(() => {
    return () => {
      doc?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  return { doc, numPages, error, loading };
}
