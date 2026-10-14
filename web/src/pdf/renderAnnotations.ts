// Render PDF link annotations as clickable transparent overlays.
//
// Uses the raw annotation data from PDF.js rather than the AnnotationLayer
// class, which has a complex API. Each link annotation becomes a positioned
// <div> that intercepts clicks for internal page navigation or external URLs.

import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist';

/**
 * Render link annotations for `page` as absolutely-positioned clickable
 * overlays inside `container`. Clears any previous overlays first so
 * re-renders (e.g. on zoom) do not stack elements.
 *
 * @param page        - PDFPageProxy for the page being rendered
 * @param viewport    - PageViewport used when rendering the canvas
 * @param container   - Div that receives the overlay elements (.pdf-annot-layer)
 * @param doc         - PDFDocumentProxy, needed to resolve named destinations
 * @param onGoToPage  - Called with a 1-indexed page number for internal links
 */
export async function renderAnnotations(
  page: PDFPageProxy,
  viewport: PageViewport,
  container: HTMLDivElement,
  doc: PDFDocumentProxy,
  onGoToPage: (pageNumber: number) => void,
): Promise<void> {
  // Clear overlays from any previous render at this container.
  container.querySelectorAll('.pdf-annot-link').forEach((el) => el.remove());

  const annotations = await page.getAnnotations();

  for (const annotation of annotations) {
    if (annotation.subtype !== 'Link') continue;

    // Convert PDF rect (user-space) to viewport (CSS px) coordinates.
    // convertToViewportRectangle may return coords where x1>x2 or y1>y2
    // depending on the PDF's coordinate origin, so normalise with min/max.
    const vr = viewport.convertToViewportRectangle(
      annotation.rect as [number, number, number, number],
    );
    const left = Math.min(vr[0], vr[2]);
    const top = Math.min(vr[1], vr[3]);
    const width = Math.abs(vr[2] - vr[0]);
    const height = Math.abs(vr[3] - vr[1]);

    const div = document.createElement('div');
    div.className = 'pdf-annot-link';
    div.style.left = `${left}px`;
    div.style.top = `${top}px`;
    div.style.width = `${width}px`;
    div.style.height = `${height}px`;

    if (annotation.dest != null) {
      // Internal link — resolve destination to a page number.
      div.addEventListener('click', async () => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let dest: any = annotation.dest;
          if (typeof dest === 'string') {
            dest = await doc.getDestination(dest); // named → explicit
          }
          if (Array.isArray(dest) && dest[0] != null) {
            const pageIndex = await doc.getPageIndex(
              dest[0] as { num: number; gen: number },
            );
            onGoToPage(pageIndex + 1); // 0-indexed → 1-indexed
          }
        } catch {
          // Ignore navigation errors for malformed destinations.
        }
      });
    } else if (annotation.url) {
      const href = annotation.url as string;
      div.addEventListener('click', () => {
        window.open(href, '_blank', 'noopener');
      });
    } else if (annotation.unsafeUrl) {
      const href = annotation.unsafeUrl as string;
      div.addEventListener('click', () => {
        window.open(href, '_blank', 'noopener');
      });
    } else {
      continue; // No actionable target — skip.
    }

    container.appendChild(div);
  }
}
