// Library: dashboard home screen. Lists the current user's PDFs, lets them
// upload a new PDF, open one into the viewer, or delete one.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Document } from '../types';
import { computeFileHash } from '../hash';
import { deletePdf, listPdfs, uploadPdf } from '../api';

interface LibraryProps {
  onOpen: (doc: Document) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** Deterministic color index 0-7 derived from the first 6 hex chars of fileHash. */
function cardColorIdx(fileHash: string): number {
  const n = parseInt(fileHash.slice(0, 6), 16);
  return isNaN(n) ? 0 : n % 8;
}

const MAX_STORAGE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB display cap

// ---------------------------------------------------------------------------
// Inline SVG icons (no external icon library)
// ---------------------------------------------------------------------------

function UploadIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 16 12 12 8 16" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function BookIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function BookOpenIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function FolderOpenIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface CardProps {
  doc: Document;
  colorIdx: number;
  busy: boolean;
  onOpen: (doc: Document) => void;
  onDelete: (doc: Document) => void;
}

function GridCard({ doc, colorIdx, busy, onOpen, onDelete }: CardProps) {
  const hasProgress = doc.lastHighlightId !== null;
  const displayName = doc.title || doc.fileName;

  return (
    <div className="lib-card">
      <div className={`lib-card-cover lib-card-cover--${colorIdx}`}>
        <div className="lib-card-cover-top">
          <button
            type="button"
            className="lib-card-delete-btn"
            onClick={() => onDelete(doc)}
            disabled={busy}
            aria-label={`Delete ${doc.fileName}`}
            title="Delete"
          >
            <TrashIcon />
          </button>
        </div>
        <div>
          <span className="lib-card-cover-icon">
            <BookIcon size={28} />
          </span>
          <p className="lib-card-title">{displayName}</p>
        </div>
      </div>

      <div className="lib-card-body">
        {doc.title && doc.title !== doc.fileName && (
          <p className="lib-card-filename">{doc.fileName}</p>
        )}
        <span className={`lib-badge ${hasProgress ? 'lib-badge--progress' : 'lib-badge--not-started'}`}>
          {hasProgress ? '● In Progress' : '○ Not Started'}
        </span>
      </div>

      <div className="lib-card-footer">
        <span className="lib-card-size">{formatSize(doc.size)}</span>
        <button
          type="button"
          className="lib-read-btn"
          onClick={() => onOpen(doc)}
        >
          <BookOpenIcon size={14} />
          <span>Read</span>
        </button>
      </div>
    </div>
  );
}

function ListRow({ doc, colorIdx, busy, onOpen, onDelete }: CardProps) {
  const hasProgress = doc.lastHighlightId !== null;
  const displayName = doc.title || doc.fileName;

  return (
    <div className="lib-list-row">
      <div className={`lib-list-icon lib-list-icon--${colorIdx}`}>
        <BookIcon size={20} />
      </div>

      <div className="lib-list-info">
        <p className="lib-list-title">{displayName}</p>
        <p className="lib-list-filename">{doc.fileName}</p>
      </div>

      <div className="lib-list-meta">
        <span className={`lib-badge ${hasProgress ? 'lib-badge--progress' : 'lib-badge--not-started'}`}>
          {hasProgress ? 'In Progress' : 'Not Started'}
        </span>
        <span className="lib-list-size">{formatSize(doc.size)}</span>
        <button
          type="button"
          className="lib-read-btn"
          onClick={() => onOpen(doc)}
        >
          <BookOpenIcon size={13} />
          <span>Read</span>
        </button>
        <button
          type="button"
          className="lib-list-delete"
          onClick={() => onDelete(doc)}
          disabled={busy}
          aria-label={`Delete ${doc.fileName}`}
          title="Delete"
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Library({ onOpen }: LibraryProps) {
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listPdfs();
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

  const uploadFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const bytes = await file.arrayBuffer();
        const fileHash = await computeFileHash(bytes);
        const doc = await uploadPdf(bytes, { fileHash, fileName: file.name, size: file.size });
        setDocs((prev) => {
          const next = [doc, ...prev.filter((d) => d.fileHash !== doc.fileHash)];
          next.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
          return next;
        });
        void refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const onUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (!file) return;
      void uploadFile(file);
    },
    [uploadFile],
  );

  const isPdf = (file: File) =>
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      if (busy) return;
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      if (!isPdf(file)) {
        setError('Only PDF files are supported');
        return;
      }
      void uploadFile(file);
    },
    [busy, uploadFile],
  );

  const onDelete = useCallback(async (doc: Document) => {
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
  }, []);

  // Client-side search filter
  const filtered = docs.filter((d) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (d.title || d.fileName).toLowerCase().includes(q) ||
      d.fileName.toLowerCase().includes(q)
    );
  });

  // Storage indicator
  const totalSize = docs.reduce((sum, d) => sum + (d.size ?? 0), 0);
  const storagePercent = Math.min(100, (totalSize / MAX_STORAGE_BYTES) * 100);

  return (
    <div
      className="lib-layout"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="lib-sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Left sidebar */}
      <aside className={`lib-sidebar${sidebarOpen ? ' lib-sidebar--open' : ''}`}>
        <div className="lib-sidebar-scroll">
          <div className="lib-sidebar-section">
            <span className="lib-sidebar-label">Library</span>
            <nav>
              <button type="button" className="lib-nav-item lib-nav-item--active">
                <GridIcon />
                <span style={{ flex: 1 }}>All Documents</span>
                <span className="lib-nav-count">{docs.length}</span>
              </button>
            </nav>
          </div>
        </div>

        <div className="lib-sidebar-footer">
          <div className="lib-storage-row">
            <span>Storage Used</span>
            <span>{formatSize(totalSize)}</span>
          </div>
          <div className="lib-storage-track">
            <div
              className="lib-storage-fill"
              style={{ width: `${storagePercent}%` }}
            />
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="lib-main">
        {/* Upload drop zone */}
        <div
          className={`lib-dropzone${dragActive ? ' lib-dropzone--active' : ''}`}
          onClick={() => { if (!busy) fileInputRef.current?.click(); }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
          }}
          aria-label="Upload PDF"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={onUpload}
            disabled={busy}
            style={{ display: 'none' }}
          />
          <div className="lib-dropzone-icon">
            <UploadIcon />
          </div>
          <p className="lib-dropzone-text">
            {busy ? (
              'Uploading…'
            ) : (
              <>
                Drag &amp; drop a PDF here, or{' '}
                <span className="lib-dropzone-link">Choose File</span>
              </>
            )}
          </p>
          <p className="lib-dropzone-hint">Supports PDF up to 100 MB</p>
        </div>

        {/* Toolbar */}
        <div className="lib-toolbar">
          <div className="lib-toolbar-info">
            <h2 className="lib-toolbar-title">Your Documents</h2>
            <p className="lib-toolbar-count">
              Showing {filtered.length} {filtered.length === 1 ? 'file' : 'files'} in your library
            </p>
          </div>

          <div className="lib-toolbar-controls">
            {/* Mobile sidebar toggle (hidden on desktop via CSS) */}
            <button
              type="button"
              className="lib-sidebar-toggle"
              onClick={() => setSidebarOpen((s) => !s)}
              aria-label="Toggle sidebar"
            >
              <MenuIcon />
            </button>

            {/* Search */}
            <div className="lib-search">
              <span className="lib-search-icon">
                <SearchIcon />
              </span>
              <input
                type="search"
                className="lib-search-input"
                placeholder="Search…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search documents"
              />
            </div>

            {/* Grid / list toggle */}
            <div className="lib-view-toggle" role="group" aria-label="View mode">
              <button
                type="button"
                className={`lib-view-btn${view === 'grid' ? ' lib-view-btn--active' : ''}`}
                onClick={() => setView('grid')}
                title="Grid view"
                aria-pressed={view === 'grid'}
              >
                <GridIcon />
              </button>
              <button
                type="button"
                className={`lib-view-btn${view === 'list' ? ' lib-view-btn--active' : ''}`}
                onClick={() => setView('list')}
                title="List view"
                aria-pressed={view === 'list'}
              >
                <ListIcon />
              </button>
            </div>
          </div>
        </div>

        {/* Error message */}
        {error && <p className="lib-error">{error}</p>}

        {/* Document list */}
        {loading ? (
          <p className="lib-status">Loading your library…</p>
        ) : filtered.length === 0 ? (
          <div className="lib-empty">
            <div className="lib-empty-icon">
              <FolderOpenIcon />
            </div>
            <p className="lib-empty-title">
              {searchQuery ? 'No documents found' : 'No PDFs yet'}
            </p>
            <p className="lib-empty-text">
              {searchQuery
                ? 'Try adjusting your search query.'
                : 'Upload a PDF above to start reading.'}
            </p>
          </div>
        ) : view === 'grid' ? (
          <div className="lib-grid">
            {filtered.map((doc) => (
              <GridCard
                key={doc.fileHash}
                doc={doc}
                colorIdx={cardColorIdx(doc.fileHash)}
                busy={busy}
                onOpen={onOpen}
                onDelete={onDelete}
              />
            ))}
          </div>
        ) : (
          <div className="lib-list">
            {filtered.map((doc) => (
              <ListRow
                key={doc.fileHash}
                doc={doc}
                colorIdx={cardColorIdx(doc.fileHash)}
                busy={busy}
                onOpen={onOpen}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
