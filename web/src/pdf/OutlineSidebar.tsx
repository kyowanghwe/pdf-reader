// Left outline sidebar — renders the PDF's table-of-contents (via
// doc.getOutline()) as a clickable, collapsible tree. Clicking an entry
// scrolls the viewer to that destination. Shows "No chapters available"
// when the PDF has no outline. The whole sidebar can be collapsed via the
// edge toggle, resized by dragging its right edge, and each parent node can
// be expanded/collapsed independently.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { pageContainerId } from './PdfViewer';

/** Shape returned by PDFDocumentProxy.getOutline(). */
interface OutlineItem {
  title: string;
  dest: string | unknown[] | null;
  items: OutlineItem[];
}

interface OutlineSidebarProps {
  doc: PDFDocumentProxy;
  open: boolean;
  onToggle: () => void;
}

const WIDTH_STORAGE_KEY = 'pdfreader.chapterSidebarWidth';
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 180;
const MAX_WIDTH = 480;

function getStoredWidth(): number {
  const raw = localStorage.getItem(WIDTH_STORAGE_KEY);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n));
}

/** Resolve an outline destination to a page number (1-based) and scroll to it. */
async function navigateTo(doc: PDFDocumentProxy, dest: string | unknown[] | null) {
  if (!dest) {
    console.warn('[outline] Entry has no destination');
    return;
  }

  try {
    let resolved: unknown[];
    if (typeof dest === 'string') {
      // Named destination — resolve to an explicit dest array.
      const named = await doc.getDestination(dest);
      if (!named) {
        console.warn('[outline] Named destination not found:', dest);
        return;
      }
      resolved = named;
    } else {
      resolved = dest;
    }

    // resolved[0] is a Ref — get the 0-based page index via getPageIndex.
    const ref = resolved[0];
    const pageIndex = await doc.getPageIndex(ref as { num: number; gen: number });
    const pageNumber = pageIndex + 1;
    const el = document.getElementById(pageContainerId(pageNumber));
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    console.warn('[outline] Failed to resolve destination:', err);
  }
}

function OutlineTree({
  items,
  doc,
  path,
  expanded,
  onToggleNode,
}: {
  items: OutlineItem[];
  doc: PDFDocumentProxy;
  path: string;
  expanded: Set<string>;
  onToggleNode: (id: string) => void;
}) {
  const handleClick = useCallback(
    (dest: string | unknown[] | null) => {
      void navigateTo(doc, dest);
    },
    [doc],
  );

  return (
    <ul className="outline-list">
      {items.map((item, i) => {
        const nodeId = `${path}/${i}`;
        const hasChildren = item.items && item.items.length > 0;
        const isExpanded = expanded.has(nodeId);
        return (
          <li key={`${item.title}-${i}`} className="outline-node">
            <div className="outline-row">
              {hasChildren ? (
                <button
                  type="button"
                  className="outline-arrow"
                  onClick={() => onToggleNode(nodeId)}
                  aria-label={isExpanded ? 'Collapse section' : 'Expand section'}
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? '▼' : '▶'}
                </button>
              ) : (
                <span className="outline-arrow outline-arrow-spacer" aria-hidden="true" />
              )}
              <button
                type="button"
                className="outline-item"
                onClick={() => handleClick(item.dest)}
                title={item.title}
              >
                {item.title}
              </button>
            </div>
            {hasChildren && isExpanded && (
              <OutlineTree
                items={item.items}
                doc={doc}
                path={nodeId}
                expanded={expanded}
                onToggleNode={onToggleNode}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function OutlineSidebar({ doc, open, onToggle }: OutlineSidebarProps) {
  const [outline, setOutline] = useState<OutlineItem[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [width, setWidth] = useState<number>(getStoredWidth);
  const resizingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    doc.getOutline().then((result) => {
      if (cancelled) return;
      const items = result as OutlineItem[] | null;
      setOutline(items);
      // Default: expand the top-level nodes so the first level is visible.
      if (items && items.length > 0) {
        setExpanded(new Set(items.map((_, i) => `root/${i}`)));
      } else {
        setExpanded(new Set());
      }
    });
    return () => {
      cancelled = true;
    };
  }, [doc]);

  const toggleNode = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Mouse-drag resize: track mousemove on document, mouseup to end.
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, ev.clientX));
      setWidth(next);
    };
    const onUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setWidth((w) => {
        localStorage.setItem(WIDTH_STORAGE_KEY, String(w));
        return w;
      });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const hasOutline = outline != null && outline.length > 0;

  return (
    <aside
      className={`outline-sidebar${open ? ' is-open' : ''}`}
      style={open ? { width } : undefined}
    >
      <button
        type="button"
        className="outline-toggle"
        onClick={onToggle}
        aria-label={open ? 'Collapse chapters' : 'Expand chapters'}
        title={open ? 'Collapse chapters' : 'Expand chapters'}
      >
        {open ? '◀' : '▶'}
      </button>
      {open && (
        <>
          <div className="outline-content">
            <h2 className="outline-heading">Chapters</h2>
            {hasOutline ? (
              <OutlineTree
                items={outline}
                doc={doc}
                path="root"
                expanded={expanded}
                onToggleNode={toggleNode}
              />
            ) : (
              <p className="outline-empty">No chapters available</p>
            )}
          </div>
          <div
            className="outline-resize-handle"
            onMouseDown={startResize}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize chapters sidebar"
            title="Drag to resize"
          />
        </>
      )}
    </aside>
  );
}

export { type OutlineItem };
