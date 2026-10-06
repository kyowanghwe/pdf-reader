import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { renderPage } from './renderPage';
import { renderTextLayer } from './textLayer';
import { Controls } from './Controls';
import { Overlay } from '../highlights/Overlay';
import type { Highlight } from '../types';

/** DOM id for a page container, used by later jump-to-highlight logic. */
export function pageContainerId(page: number): string {
  return `pdf-page-${page}`;
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
  /** Fired when text is selected inside a page (mouseup with a selection). */
  onSelection?: () => void;
}

interface PageProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  highlights: Highlight[];
}

/** Renders a single page: canvas + overlaid selectable text layer + highlights. */
function Page({ doc, pageNumber, scale, highlights }: PageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
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

      container.style.width = `${w}px`;
      container.style.height = `${h}px`;

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
  }, [doc, pageNumber, scale]);

  return (
    <div
      id={pageContainerId(pageNumber)}
      data-page-number={pageNumber}
      className="pdf-page"
      ref={containerRef}
    >
      <canvas ref={canvasRef} className="pdf-canvas" />
      <div ref={textLayerRef} className="textLayer" />
      <Overlay highlights={highlights} renderedWidth={size.w} renderedHeight={size.h} />
    </div>
  );
}

export function PdfViewer({
  doc,
  numPages,
  scale,
  onZoomIn,
  onZoomOut,
  onScroll,
  highlights = [],
  onSelection,
}: PdfViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currentPage, setCurrentPage] = useState(1);

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
      onSelection?.();
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
        {Array.from({ length: numPages }, (_, i) => (
          <Page
            key={i + 1}
            doc={doc}
            pageNumber={i + 1}
            scale={scale}
            highlights={byPage.get(i + 1) ?? []}
          />
        ))}
      </div>
    </div>
  );
}
