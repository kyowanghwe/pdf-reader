// Library: the entry screen. Lists the current user's PDFs (from R2 via the
// Worker), lets them upload a new PDF, open one into the viewer, or delete one.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Document } from '../types';
import { computeFileHash } from '../hash';
import { deletePdf, listPdfs, uploadPdf } from '../api';

interface LibraryProps {
  /** Open a document into the viewer. */
  onOpen: (doc: Document) => void;
}

function formatSize(bytes: number): string {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function Library({ onOpen }: LibraryProps) {
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listPdfs();
      // Most recently opened first.
      list.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
      setDocs(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load library');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Allow re-selecting the same file later.
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (!file) return;

      setBusy(true);
      setError(null);
      try {
        const bytes = await file.arrayBuffer();
        const fileHash = await computeFileHash(bytes);
        await uploadPdf(bytes, { fileHash, fileName: file.name, size: file.size });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const onDelete = useCallback(
    async (doc: Document) => {
      setBusy(true);
      setError(null);
      try {
        await deletePdf(doc.fileHash);
        setDocs((prev) => prev.filter((d) => d.fileHash !== doc.fileHash));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Delete failed');
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return (
    <section className="library">
      <div className="library-header">
        <h2>Your PDFs</h2>
        <label className="library-upload">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={onUpload}
            disabled={busy}
          />
          <span>{busy ? 'Uploading…' : 'Upload a PDF'}</span>
        </label>
      </div>

      {error && <p className="library-error">{error}</p>}

      {loading ? (
        <p className="library-status">Loading your library…</p>
      ) : docs.length === 0 ? (
        <p className="library-status">
          No PDFs yet. Upload one to start reading.
        </p>
      ) : (
        <ul className="library-list">
          {docs.map((doc) => (
            <li key={doc.fileHash} className="library-item">
              <button
                type="button"
                className="library-item-main"
                onClick={() => onOpen(doc)}
                title="Open"
              >
                <span className="library-item-name">{doc.title || doc.fileName}</span>
                <span className="library-item-meta">{formatSize(doc.size)}</span>
              </button>
              <button
                type="button"
                className="library-delete"
                onClick={() => onDelete(doc)}
                disabled={busy}
                aria-label={`Delete ${doc.fileName}`}
                title="Delete"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
