// Render the selectable text layer for a PDF page (PDF.js v4 TextLayer API).
//
// The text layer is a stack of transparent, absolutely-positioned spans laid
// over the canvas so the browser's native selection works on top of the
// rendered image. Spans are positioned via the `--scale-factor` CSS var set on
// the page container (see PdfViewer).

import { TextLayer } from 'pdfjs-dist';
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';

/**
 * Render `page`'s text into `container`, laid out against `viewport`. Clears any
 * previous content first so re-renders (e.g. on zoom) do not stack spans.
 */
export async function renderTextLayer(
  page: PDFPageProxy,
  viewport: PageViewport,
  container: HTMLElement,
): Promise<void> {
  // Clear stale spans from a previous render at a different scale.
  container.replaceChildren();

  const textLayer = new TextLayer({
    textContentSource: page.streamTextContent(),
    container,
    viewport,
  });

  await textLayer.render();
}
