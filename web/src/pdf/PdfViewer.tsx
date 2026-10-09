import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { renderPage } from './renderPage';
import { renderTextLayer } from './textLayer';
import { Controls } from './Controls';
import { PageBar } from './PageBar';
import { Overlay } from '../highlights/Overlay';
import type { Highlight } from '../types';

/** DOM id for a page container, used by later jump-to-highlight logic. */
export function pageContainerId(page: number): string {
  return `pdf-page-${page}`;
}

/** Pages above/below the visible range that are pre-rendered as a buffer. */
const RENDER_BUFFER = 2;

/** Imperative handle exposed to the parent (App) for jump-to-highlight. */
export interface PdfViewerHandle {
  /** Immediately add a page to the rendered set. Call before jumpToHighlight. */
  ensurePageRendered(page: number): void;
}

interface PdfViewerProps {
  doc: PDFDocumentProxy;
  numPages: number;
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** Fired on scroll with the scroll container's scrollTop and the current page. */
  onScroll?: (info: { scrollTop: number; page: number }) => void;
  /** All highlights for the current document, used to draw overlays per page. */
  highlights?: Highlight[];
  /**
   * Fired on mouseup inside .pdf-scroll. Receives the selection's bounding
   * rect (non-null for a valid non-empty selection) or null to dismiss.
   */
  onSelection?: (rect: DOMRect | null) => void;
}

interface PageProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  highlights: Highlight[];
  /** Placeholder dimensions (CSS px) so the container reserves correct space. */
  dims: { w: number; h: number };
  /** true = render canvas + text layer; false = sized placeholder only. */
  rendered: boolean;
}

/**
 * Renders a single page. Always renders the sized container (placeholder) so
 * scroll geometry is stable; only paints the canvas + text layer when
 * `rendered` is true (virtualization).
 */
function Page({ doc, pageNumber, scale, highlights, dims, rendered }: PageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    if (!rendered) {
      // Not rendered: clear any painted size so the Overlay stays hidden.
      setSize({ w: 0, h: 0 });
      return;
    }

    let cancelled = false;
    let page: PDFPageProxy | null = null;

    (async () => {
      const loaded = await doc.getPage(pageNumber);
      if (cancelled) return;
      page = loaded;

      const canvas = canvasRef.current;
      const container = containerRef.current;
      const textLayer = textLayerRef.current;
      if (!canvas || !container || !textLayer) return;

      const viewport = await renderPage(page, scale, canvas);
      if (cancelled) return;

      const w = Math.floor(viewport.width);
      const h = Math.floor(viewport.height);

      // The TextLayer uses the `--scale-factor` CSS var to position spans.
      container.style.setProperty('--scale-factor', String(scale));

      textLayer.style.width = `${w}px`;
      textLayer.style.height = `${h}px`;

      await renderTextLayer(page, viewport, textLayer);
      if (cancelled) return;
      setSize({ w, h });
    })();

    return () => {
      cancelled = true;
      page?.cleanup();
    };
  }, [doc, pageNumber, scale, rendered]);

  return (
    <div
      id={pageContainerId(pageNumber)}
      data-page-number={pageNumber}
      className="pdf-page"
      ref={containerRef}
      style={{ width: dims.w, height: dims.h }}
    >
      {rendered && (
        <>
          <canvas ref={canvasRef} className="pdf-canvas" />
          <div ref={textLayerRef} className="textLayer" />
        </>
      )}
      <Overlay highlights={highlights} renderedWidth={size.w} renderedHeight={size.h} />
    </div>
  );
}

export const PdfViewer = forwardRef<PdfViewerHandle, PdfViewerProps>(
  function PdfViewer(
    {
      doc,
      numPages,
      scale,
      onZoomIn,
      onZoomOut,
      onScroll,
      highlights = [],
      onSelection,
    },
    ref,
  ) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [currentPage, setCurrentPage] = useState(1);

    // Placeholder dimensions per page (CSS px) at the current scale. Reserves
    // scroll space before any canvas renders so the scrollbar + page positions
    // are correct immediately.
    const [pageDims, setPageDims] = useState<{ w: number; h: number }[]>([]);

    // Which pages are actually painted (canvas + text layer). Start with the
    // first few so the top of the document shows immediately.
    const [renderedPages, setRenderedPages] = useState<Set<number>>(
      () => new Set([1, 2, 3]),
    );

    // Expose an imperative hook so the parent can force a page to render before
    // jumping to an off-screen highlight.
    useImperativeHandle(ref, () => ({
      ensurePageRendered(page: number) {
        setRenderedPages((prev) => {
          if (prev.has(page)) return prev;
          const next = new Set(prev);
          next.add(page);
          return next;
        });
      },
    }));

    // Pre-fetch each page's dimensions at the current scale. Runs on mount and
    // whenever the doc/scale/numPages change. getPage for viewport sizing does
    // not decode image streams and is fast; cleanup() releases it immediately.
    useEffect(() => {
      let cancelled = false;
      setPageDims([]); // clear stale dims immediately (e.g. on scale change)
      (async () => {
        const dims = await Promise.all(
          Array.from({ length: numPages }, async (_, i) => {
            const p = await doc.getPage(i + 1);
            const vp = p.getViewport({ scale });
            p.cleanup(); // only the viewport size was needed
            return { w: Math.floor(vp.width), h: Math.floor(vp.height) };
          }),
        );
        if (!cancelled) setPageDims(dims);
      })();
      return () => {
        cancelled = true;
      };
    }, [doc, numPages, scale]);

    // On scale change, reset the rendered set — old canvases have the wrong
    // size and must repaint at the new scale.
    useEffect(() => {
      setRenderedPages(new Set([1, 2, 3]));
    }, [scale]);

    // IntersectionObserver: decide which pages get canvas + text based on
    // viewport proximity. Set up once placeholders are in the DOM.
    useEffect(() => {
      const el = scrollRef.current;
      if (!el || pageDims.length === 0) return;

      const visibleNow = new Set<number>();

      const updateRendered = () => {
        const toRender = new Set<number>();
        for (const p of visibleNow) {
          for (
            let n = Math.max(1, p - RENDER_BUFFER);
            n <= Math.min(numPages, p + RENDER_BUFFER);
            n += 1
          ) {
            toRender.add(n);
          }
        }
        // Keep pages 1-3 rendered if nothing is visible yet (initial load).
        if (toRender.size === 0) {
          toRender.add(1);
          toRender.add(2);
          toRender.add(3);
        }
        setRenderedPages((prev) => {
          // Skip the state update when the proximity set is unchanged to avoid a
          // needless re-render on every scroll tick.
          if (prev.size === toRender.size && [...prev].every((p) => toRender.has(p))) {
            return prev;
          }
          return toRender;
        });
      };

      const obs = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const p = Number((entry.target as HTMLElement).dataset.pageNumber);
            if (!Number.isFinite(p) || p < 1) continue;
            if (entry.isIntersecting) visibleNow.add(p);
            else visibleNow.delete(p);
          }
          updateRendered();
        },
        {
          root: el,
          // 300px lookahead: pre-render pages about to enter the viewport so
          // the canvas is ready before the user actually sees the page.
          rootMargin: '300px 0px',
        },
      );

      el.querySelectorAll<HTMLElement>('[data-page-number]').forEach((pg) =>
        obs.observe(pg),
      );

      return () => obs.disconnect();
      // Only rebuild when the page count changes; scale changes reuse the same
      // observed elements (handled by the reset effect above).
    }, [numPages, pageDims.length]);

    // Determine the page nearest the top of the viewport on scroll.
    useLayoutEffect(() => {
      const el = scrollRef.current;
      if (!el) return;

      const handleScroll = () => {
        const pages = el.querySelectorAll<HTMLElement>('.pdf-page');
        const containerTop = el.getBoundingClientRect().top;
        let active = 1;
        for (const page of pages) {
          const rect = page.getBoundingClientRect();
          // First page whose bottom is still below the container top wins.
          if (rect.bottom - containerTop > 1) {
            active = Number(page.dataset.pageNumber) || 1;
            break;
          }
        }
        setCurrentPage(active);
        onScroll?.({ scrollTop: el.scrollTop, page: active });
      };

      el.addEventListener('scroll', handleScroll, { passive: true });
      return () => el.removeEventListener('scroll', handleScroll);
    }, [onScroll]);

    const goToPage = (page: number) => {
      const clamped = Math.min(Math.max(page, 1), numPages);
      const target = document.getElementById(pageContainerId(clamped));
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setCurrentPage(clamped);
    };

    // Group highlights by page so each Page only re-renders with its own set.
    const byPage = new Map<number, Highlight[]>();
    for (const h of highlights) {
      const list = byPage.get(h.page) ?? [];
      list.push(h);
      byPage.set(h.page, list);
    }

    const handleMouseUp = () => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim()) {
        try {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          onSelection?.(rect);
        } catch {
          onSelection?.(null);
        }
      } else {
        onSelection?.(null);
      }
    };

    return (
      <div className="pdf-viewer">
        <Controls
          currentPage={currentPage}
          numPages={numPages}
          scale={scale}
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          onPrev={() => goToPage(currentPage - 1)}
          onNext={() => goToPage(currentPage + 1)}
        />
        <div className="pdf-scroll" ref={scrollRef} onMouseUp={handleMouseUp}>
          {pageDims.length > 0
            ? pageDims.map((dims, i) => (
                <Page
                  key={i + 1}
                  doc={doc}
                  pageNumber={i + 1}
                  scale={scale}
                  highlights={byPage.get(i + 1) ?? []}
                  dims={dims}
                  rendered={renderedPages.has(i + 1)}
                />
              ))
            : null /* dims loading: App.tsx shows the loading indicator */}
        </div>
        <PageBar currentPage={currentPage} numPages={numPages} />
      </div>
    );
  },
);
