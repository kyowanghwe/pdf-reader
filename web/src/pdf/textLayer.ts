import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';
import { pdfjs } from './pdfSetup';

/**
 * Renders a selectable text layer over a rendered page using the PDF.js v4
 * `TextLayer` CLASS (the old `renderTextLayer` helper is deprecated in v4).
 *
 * The container must be absolutely positioned over the canvas and sized to the
 * viewport's CSS dimensions. The accompanying CSS (styles.css) aligns the spans.
 */
export async function renderTextLayer(
  page: PDFPageProxy,
  viewport: PageViewport,
  container: HTMLElement,
): Promise<void> {
  // Clear any previous render (e.g. on zoom change).
  container.replaceChildren();

  const textLayer = new pdfjs.TextLayer({
    textContentSource: page.streamTextContent(),
    container,
    viewport,
  });

  await textLayer.render();
}
