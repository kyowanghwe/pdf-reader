import { useCallback, useEffect, useRef, useState } from 'react';
import { usePdfDocument } from './pdf/usePdfDocument';
import { PdfViewer, pageContainerId } from './pdf/PdfViewer';
import { OutlineSidebar } from './pdf/OutlineSidebar';
import {
  HighlightStoreProvider,
  useHighlightStore,
} from './highlights/store';
import { Sidebar } from './highlights/Sidebar';
import { SelectionPopup, HIGHLIGHT_YELLOW } from './highlights/SelectionPopup';
import { fromSelection } from './highlights/fromSelection';
import { jumpToHighlight } from './highlights/jump';
import { Library } from './library/Library';
import { getPdf } from './api';
import { getIdentity, getLogoutUrl, type UserIdentity } from './identity';
import { getStoredTheme, setStoredTheme, type Theme } from './theme';
import type { Document, Highlight, Progress } from './types';

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;
const PROGRESS_DEBOUNCE_MS = 400;
const HIGHLIGHTS_PANEL_KEY = 'pdfreader.highlightsPanelOpen';

export default function App() {
  const [data, setData] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [fileHash, setFileHash] = useState<string>('');
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [scale, setScale] = useState(1.25);
  const [resume, setResume] = useState<Progress | null>(null);

  const [identity, setIdentity] = useState<UserIdentity | null>(null);
  const [theme, setTheme] = useState<Theme>(getStoredTheme());
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [highlightSidebarOpen, setHighlightSidebarOpen] = useState(
    () => localStorage.getItem(HIGHLIGHTS_PANEL_KEY) !== 'false',
  );
  const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(null);

  const { doc, numPages, error, loading } = usePdfDocument(data);
  const { store, highlights, progress } = useHighlightStore();

  const docHighlights = fileHash ? highlights[fileHash] ?? [] : [];

  const progressTimer = useRef<number | null>(null);

  // Fetch the signed-in identity once on mount.
  useEffect(() => {
    getIdentity().then(setIdentity);
  }, []);

  // Persist + apply theme.
  const changeTheme = useCallback((next: Theme) => {
    setTheme(next);
    setStoredTheme(next);
  }, []);

  // Open the left outline sidebar automatically when the document has an outline.
  useEffect(() => {
    setOutlineOpen(false);
    if (!doc) return;
    let cancelled = false;
    doc.getOutline().then((outline) => {
      if (!cancelled && outline && outline.length > 0) setOutlineOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, [doc]);

  // Dismiss the selection popup on an outside mousedown.
  useEffect(() => {
    if (!popupPos) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.selection-popup')) return;
      setPopupPos(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [popupPos]);

  // Open a library document: stream its bytes from R2 and hydrate highlights +
  // progress. The Document's fileHash is the real hex SHA-256 computed at upload,
  // so it keys highlights/progress correctly.
  const openDocument = useCallback(
    async (document: Document) => {
      setOpening(true);
      setOpenError(null);
      try {
        const bytes = await getPdf(document.fileHash);
        await store.loadDocument(document.fileHash, document);
        setFileName(document.title || document.fileName);
        setFileHash(document.fileHash);
        setData(bytes);
        setResume(store.getProgress(document.fileHash));
      } catch (err) {
        setOpenError(err instanceof Error ? err.message : 'Failed to open PDF');
      } finally {
        setOpening(false);
      }
    },
    [store],
  );

  // Return to the library entry screen.
  const closeDocument = useCallback(() => {
    setData(null);
    setFileHash('');
    setFileName('');
    setResume(null);
    setOpenError(null);
    setPopupPos(null);
  }, []);

  const zoomIn = useCallback(
    () => setScale((s) => Math.min(MAX_SCALE, +(s + SCALE_STEP).toFixed(2))),
    [],
  );
  const zoomOut = useCallback(
    () => setScale((s) => Math.max(MIN_SCALE, +(s - SCALE_STEP).toFixed(2))),
    [],
  );

  // Selection -> popup: on mouseup inside the viewer, show/dismiss the popup.
  const onSelection = useCallback((rect: DOMRect | null) => {
    if (!rect) {
      setPopupPos(null);
      return;
    }
    // Position the popup just above the selection, centered horizontally.
    setPopupPos({ x: rect.left + rect.width / 2, y: Math.max(rect.top - 8, 8) });
  }, []);

  // Create yellow highlight(s) for the current selection.
  const createHighlightFromSelection = useCallback(() => {
    if (!fileHash) return;
    const results = fromSelection();
    setPopupPos(null);
    if (results.length === 0) return;
    let last: Highlight | null = null;
    for (const r of results) {
      last = store.addHighlight({
        fileHash,
        page: r.page,
        rects: r.rects,
        text: r.text,
        color: HIGHLIGHT_YELLOW,
      });
    }
    window.getSelection()?.removeAllRanges();
    // Track the newest highlight as part of progress.
    if (last) {
      const prev = store.getProgress(fileHash);
      store.setProgress({
        fileHash,
        lastHighlightId: last.id,
        scrollTop: prev?.scrollTop ?? 0,
        page: last.page,
      });
    }
  }, [fileHash, store]);

  // Progress (phase 4): debounce scroll/page changes and persist them. Also
  // dismiss the selection popup on scroll.
  const handleScroll = useCallback(
    (info: { scrollTop: number; page: number }) => {
      setPopupPos(null);
      if (!fileHash) return;
      if (progressTimer.current != null) {
        window.clearTimeout(progressTimer.current);
      }
      progressTimer.current = window.setTimeout(() => {
        const prev = store.getProgress(fileHash);
        store.setProgress({
          fileHash,
          lastHighlightId: prev?.lastHighlightId ?? null,
          scrollTop: info.scrollTop,
          page: info.page,
        });
      }, PROGRESS_DEBOUNCE_MS);
    },
    [fileHash, store],
  );

  useEffect(
    () => () => {
      if (progressTimer.current != null) {
        window.clearTimeout(progressTimer.current);
      }
    },
    [],
  );

  const jump = useCallback((h: Highlight) => jumpToHighlight(h), []);
  const remove = useCallback((id: string) => store.removeHighlight(id), [store]);

  // Toggle the highlights panel and persist its open/closed state.
  const toggleHighlightSidebar = useCallback(() => {
    setHighlightSidebarOpen((o) => {
      const next = !o;
      localStorage.setItem(HIGHLIGHTS_PANEL_KEY, String(next));
      return next;
    });
  }, []);

  // Restore saved position when the user chooses to resume.
  const doResume = useCallback(() => {
    if (!resume) return;
    const target = resume.lastHighlightId
      ? docHighlights.find((h) => h.id === resume.lastHighlightId)
      : null;
    if (target) {
      jumpToHighlight(target);
    } else {
      const pageEl = document.getElementById(pageContainerId(resume.page));
      const scroller = pageEl?.closest<HTMLElement>('.pdf-scroll');
      if (scroller) {
        scroller.scrollTo({ top: resume.scrollTop, behavior: 'smooth' });
      } else {
        pageEl?.scrollIntoView({ block: 'start' });
      }
    }
    setResume(null);
  }, [resume, docHighlights]);

  const savedProgress = fileHash ? progress[fileHash] : undefined;

  return (
    <HighlightStoreProvider value={store}>
      <div className="app" data-theme={theme}>
        <header className="app-header">
          <h1>PDF Reader</h1>
          {data && (
            <button type="button" className="app-back" onClick={closeDocument}>
              ← Library
            </button>
          )}
          {fileName && <span className="app-filename">{fileName}</span>}
          {savedProgress && (
            <span className="app-progress" title="Last saved reading position">
              Saved: page {savedProgress.page}
            </span>
          )}
          <div className="app-header-right">
            <div
              className="theme-switcher"
              role="radiogroup"
              aria-label="Reading theme"
            >
              <button
                type="button"
                className={`theme-btn${theme === 'white' ? ' is-active' : ''}`}
                aria-pressed={theme === 'white'}
                onClick={() => changeTheme('white')}
              >
                White
              </button>
              <button
                type="button"
                className={`theme-btn${theme === 'green' ? ' is-active' : ''}`}
                aria-pressed={theme === 'green'}
                onClick={() => changeTheme('green')}
              >
                Green
              </button>
            </div>
            {data && (
              <button
                type="button"
                className={`highlight-toggle${highlightSidebarOpen ? ' is-active' : ''}`}
                aria-pressed={highlightSidebarOpen}
                onClick={toggleHighlightSidebar}
              >
                Highlights
              </button>
            )}
            {identity && (
              <span className="app-user">
                Signed in as {identity.email}
                {' · '}
                <a href={getLogoutUrl()} className="app-logout">
                  Sign out
                </a>
              </span>
            )}
          </div>
        </header>

        <main className="app-main">
          {openError && <p className="app-error">{openError}</p>}
          {error && (
            <p className="app-error">Failed to load PDF: {error.message}</p>
          )}
          {(loading || opening) && <p className="app-status">Loading…</p>}

          {!data && !opening && <Library onOpen={openDocument} />}

          {doc && data && (
            <div className="app-reader">
              <OutlineSidebar
                doc={doc}
                open={outlineOpen}
                onToggle={() => setOutlineOpen((o) => !o)}
              />
              <div className="app-viewer">
                {resume && (
                  <div className="resume-banner">
                    <span>Resume where you left off (page {resume.page})?</span>
                    <button type="button" onClick={doResume}>
                      Resume
                    </button>
                    <button type="button" onClick={() => setResume(null)}>
                      Dismiss
                    </button>
                  </div>
                )}
                <PdfViewer
                  doc={doc}
                  numPages={numPages}
                  scale={scale}
                  onZoomIn={zoomIn}
                  onZoomOut={zoomOut}
                  onScroll={handleScroll}
                  highlights={docHighlights}
                  onSelection={onSelection}
                />
              </div>
              {highlightSidebarOpen && (
                <Sidebar
                  highlights={docHighlights}
                  onJump={jump}
                  onDelete={remove}
                  onClose={toggleHighlightSidebar}
                />
              )}
            </div>
          )}
        </main>

        {popupPos && (
          <SelectionPopup pos={popupPos} onHighlight={createHighlightFromSelection} />
        )}
      </div>
    </HighlightStoreProvider>
  );
}
