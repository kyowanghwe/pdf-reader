import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';

/**
 * Renders a PDF page into the given canvas at the requested scale.
 * The canvas is sized to the device pixel ratio for sharpness while its CSS size
 * stays at the viewport's logical dimensions. Returns the (CSS-sized) viewport so
 * callers can position overlays/text layers in CSS pixels.
 */
export async function renderPage(
  page: PDFPageProxy,
  scale: number,
  canvas: HTMLCanvasElement,
): Promise<PageViewport> {
  const viewport = page.getViewport({ scale });
  const outputScale = window.devicePixelRatio || 1;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not get 2D context from canvas');
  }

  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  const transform =
    outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;

  await page.render({ canvasContext: context, viewport, transform }).promise;

  return viewport;
}
