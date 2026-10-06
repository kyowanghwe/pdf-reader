// Left outline sidebar — renders the PDF's table-of-contents (via
// doc.getOutline()) as a clickable, collapsible tree. Clicking an entry
// scrolls the viewer to that destination. Shows "No chapters available"
// when the PDF has no outline.

import { useCallback, useEffect, useState } from 'react';
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
}: {
  items: OutlineItem[];
  doc: PDFDocumentProxy;
}) {
  const handleClick = useCallback(
    (dest: string | unknown[] | null) => {
      void navigateTo(doc, dest);
    },
    [doc],
  );

  return (
    <ul className="outline-list">
      {items.map((item, i) => (
        <li key={`${item.title}-${i}`} className="outline-node">
          <button
            type="button"
            className="outline-item"
            onClick={() => handleClick(item.dest)}
            title={item.title}
          >
            {item.title}
          </button>
          {item.items && item.items.length > 0 && (
            <OutlineTree items={item.items} doc={doc} />
          )}
        </li>
      ))}
    </ul>
  );
}

export function OutlineSidebar({ doc, open, onToggle }: OutlineSidebarProps) {
  const [outline, setOutline] = useState<OutlineItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    doc.getOutline().then((result) => {
      if (!cancelled) setOutline(result as OutlineItem[] | null);
    });
    return () => {
      cancelled = true;
    };
  }, [doc]);

  const hasOutline = outline != null && outline.length > 0;

  return (
    <aside className={`outline-sidebar${open ? ' is-open' : ''}`}>
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
        <div className="outline-content">
          <h2 className="outline-heading">Chapters</h2>
          {hasOutline ? (
            <OutlineTree items={outline} doc={doc} />
          ) : (
            <p className="outline-empty">No chapters available</p>
          )}
        </div>
      )}
    </aside>
  );
}

export { type OutlineItem };
