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
import { FloatTopBar } from './FloatTopBar';
import { FloatBottomBar } from './FloatBottomBar';
import { Overlay } from '../highlights/Overlay';
import type { Highlight } from '../types';
import type { Theme } from '../theme';

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
  theme: Theme;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleTheme: () => void;
  /** Fired on scroll with the scroll container's scrollTop and the current page. */
  onScroll?: (info: { scrollTop: number; page: number }) => void;
  /** All highlights for the current document, used to draw overlays per page. */
  highlights?: Highlight[];
  /**
   * Fired on mouseup inside .pdf-scroll. Receives the selection's bounding
   * rect (non-null for a valid non-empty selection) or null to dismiss.
   */
  onSelection?: (rect: DOMRect | null) => void;
  /** Called when the user clicks Highlight in the floating top toolbar. */
  onHighlight?: () => void;
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
      theme,
      onZoomIn,
      onZoomOut,
      onToggleTheme,
      onScroll,
      highlights = [],
      onSelection,
      onHighlight = () => {},
    },
    ref,
  ) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [currentPage, setCurrentPage] = useState(1);
    // Timestamp until which handleScroll is suppressed after a programmatic jump.
    const jumpUntilRef = useRef<number>(0);

    // Placeholder dimensions per page (CSS px) at the current scale. Reserves
    // scroll space before any canvas renders so the scrollbar + page positions
    // are correct immediately.
    const [pageDims, setPageDims] = useState<{ w: number; h: number }[]>([]);
    // Keep a ref in sync so goToPage interval callbacks always see the latest value.
    const pageDimsRef = useRef<{ w: number; h: number }[]>([]);
    useEffect(() => { pageDimsRef.current = pageDims; }, [pageDims]);

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

    // Pre-fetch each page's dimensions at the current scale. Fills dims
    // incrementally in batches so placeholder divs appear quickly and goToPage
    // can scroll to any page as soon as its dim is known.
    useEffect(() => {
      let cancelled = false;
      setPageDims([]);
      // Reset the ref immediately (synchronously) so goToPage polling correctly
      // waits for the new dims — without this, pageDimsRef can show the old
      // value while pageDims state is already [] (race condition on effect re-run).
      pageDimsRef.current = [];
      const BATCH = 20;
      (async () => {
        // Use a properly-filled array (no sparse slots) — new Array(n) creates
        // sparse entries that render as zero-height divs when React batches updates.
        const dims: { w: number; h: number }[] = [];
        for (let start = 0; start < numPages; start += BATCH) {
          if (cancelled) return;
          const end = Math.min(start + BATCH, numPages);
          const batch = await Promise.all(
            Array.from({ length: end - start }, async (_, i) => {
              const p = await doc.getPage(start + i + 1);
              const vp = p.getViewport({ scale });
              p.cleanup();
              return { w: Math.floor(vp.width), h: Math.floor(vp.height) };
            }),
          );
          if (cancelled) return;
          for (const d of batch) dims.push(d);
          // Publish a proper copy (no undefined slots) after each batch.
          setPageDims([...dims]);
        }
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
    // viewport proximity.
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
        if (toRender.size === 0) {
          toRender.add(1);
          toRender.add(2);
          toRender.add(3);
        }
        setRenderedPages((prev) => {
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
          rootMargin: '300px 0px',
        },
      );

      el.querySelectorAll<HTMLElement>('[data-page-number]').forEach((pg) =>
        obs.observe(pg),
      );

      return () => obs.disconnect();
    }, [numPages, pageDims.length]);

    // Determine the page nearest the top of the viewport on scroll.
    // Works for both .pdf-scroll scrolling (constrained layout) and window
    // scrolling (unconstrained layout where the window is the scroll container).
    useLayoutEffect(() => {
      const el = scrollRef.current;
      if (!el) return;

      const detectPage = () => {
        // Suppress page detection briefly after a programmatic jump so
        // setCurrentPage(clamped) in goToPage isn't overridden.
        if (Date.now() < jumpUntilRef.current) {
          console.log('[detectPage] suppressed (jump in progress)');
          return;
        }

        const pages = el.querySelectorAll<HTMLElement>('.pdf-page');
        // Use the TOP of the viewport as the reference line for page detection.
        // This works whether .pdf-scroll or the window is the scroll container.
        const constrained = el.scrollHeight > el.clientHeight + 10;
        const refY = constrained
          ? el.getBoundingClientRect().top  // .pdf-scroll is the scroll container
          : 0;                              // window is the scroll container
        let active = 1;
        for (const page of pages) {
          const rect = page.getBoundingClientRect();
          if (rect.bottom - refY > 1) {
            active = Number(page.dataset.pageNumber) || 1;
            break;
          }
        }
        console.log(`[detectPage] constrained=${constrained} | refY=${refY} | active=${active} | el.scrollTop=${el.scrollTop} | window.scrollY=${window.scrollY}`);
        setCurrentPage(active);
        onScroll?.({ scrollTop: el.scrollTop || window.scrollY, page: active });
      };

      el.addEventListener('scroll', detectPage, { passive: true });
      window.addEventListener('scroll', detectPage, { passive: true });
      return () => {
        el.removeEventListener('scroll', detectPage);
        window.removeEventListener('scroll', detectPage);
      };
    }, [onScroll]);

    const goToPage = (page: number) => {
      const clamped = Math.min(Math.max(page, 1), numPages);
      const el = scrollRef.current;
      if (!el) return;

      const doScroll = (attempt = 0) => {
        const target = document.getElementById(pageContainerId(clamped));
        // Log actual DOM heights to diagnose why pages are tiny
        const domPage1 = el.querySelector<HTMLElement>('[data-page-number="1"]');
        const domPage433 = el.querySelector<HTMLElement>('[data-page-number="433"]');
        console.log(`[jump] attempt ${attempt} | el.className: ${el.className} | el.scrollHeight ${el.scrollHeight} | el.clientHeight ${el.clientHeight}`);
        console.log(`[jump] pageDimsRef[0].h: ${pageDimsRef.current[0]?.h} | pageDimsRef[432].h: ${pageDimsRef.current[432]?.h}`);
        console.log(`[jump] DOM page-1 offsetHeight: ${domPage1?.offsetHeight} | style.height: ${domPage1?.style.height} | DOM page-433 offsetHeight: ${domPage433?.offsetHeight} | style.height: ${domPage433?.style.height}`);
        if (!target) {
          // Target not in DOM yet — wait for pageDims batch to render it.
          if (attempt < 100) window.setTimeout(() => doScroll(attempt + 1), 50);
          return;
        }
        // scrollIntoView finds the nearest scrollable ancestor automatically —
        // works whether .pdf-scroll is constrained or the window is scrolling.
        // instant avoids smooth-scroll interruption from React re-renders.
        jumpUntilRef.current = Date.now() + 600; // suppress detectPage for 600ms
        target.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'start' });
        console.log(`[jump] scrollIntoView fired for page ${clamped} | el.scrollTop after: ${el.scrollTop} | window.scrollY after: ${window.scrollY}`);
        setCurrentPage(clamped);
      };

      if (pageDimsRef.current.length >= clamped) {
        doScroll();
      } else {
        const id = window.setInterval(() => {
          if (pageDimsRef.current.length >= clamped) {
            window.clearInterval(id);
            doScroll();
          }
        }, 50);
        window.setTimeout(() => window.clearInterval(id), 5000);
      }
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

    // Mobile: use a debounced selectionchange listener so the popup only
    // appears AFTER the user stops dragging the selection handles (not
    // immediately after the long-press that selects one word).
    // This also works on desktop as a fallback; handleMouseUp gives the
    // instant response on desktop which feels better.
    useEffect(() => {
      let timerId: number | null = null;

      const handleSelectionChange = () => {
        if (timerId !== null) window.clearTimeout(timerId);
        timerId = window.setTimeout(() => {
          timerId = null;
          const selection = window.getSelection();
          if (
            selection &&
            !selection.isCollapsed &&
            selection.toString().trim() &&
            scrollRef.current &&
            selection.anchorNode &&
            scrollRef.current.contains(selection.anchorNode)
          ) {
            try {
              const range = selection.getRangeAt(0);
              const rect = range.getBoundingClientRect();
              onSelection?.(rect);
            } catch {
              onSelection?.(null);
            }
          } else if (!selection || selection.isCollapsed || !selection.toString().trim()) {
            onSelection?.(null);
          }
        }, 400);
      };

      document.addEventListener('selectionchange', handleSelectionChange);
      return () => {
        document.removeEventListener('selectionchange', handleSelectionChange);
        if (timerId !== null) window.clearTimeout(timerId);
      };
    }, [onSelection]);

    return (
      <div className="pdf-viewer">
        {/* Floating top bar — overlaid on scroll area, contains annotation tools */}
        <FloatTopBar onHighlight={onHighlight} />

        {/* Main scrollable page area */}
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

        {/* Floating bottom bar — overlaid on scroll area, nav + zoom + theme */}
        <FloatBottomBar
          currentPage={currentPage}
          numPages={numPages}
          scale={scale}
          theme={theme}
          onPrev={() => goToPage(currentPage - 1)}
          onNext={() => goToPage(currentPage + 1)}
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          onGoToPage={goToPage}
          onToggleTheme={onToggleTheme}
        />
      </div>
    );
  },
);
