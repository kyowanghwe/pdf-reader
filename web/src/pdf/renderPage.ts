// Render a single PDF page onto a canvas at a given scale.
//
// Returns the computed PageViewport so callers can size the page container and
// the overlaid text layer to match the rendered pixels. Handles HiDPI by
// backing the canvas with devicePixelRatio-scaled pixels while keeping the CSS
// box at the logical viewport size.

import type { PDFPageProxy } from 'pdfjs-dist';
import type { PageViewport } from 'pdfjs-dist';

/**
 * Paint `page` into `canvas` at `scale`. Resolves with the PageViewport used,
 * whose `width`/`height` are the logical (CSS) pixel dimensions of the page.
 */
export async function renderPage(
  page: PDFPageProxy,
  scale: number,
  canvas: HTMLCanvasElement,
): Promise<PageViewport> {
  const viewport = page.getViewport({ scale });

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not acquire 2D canvas context');
  }

  // Back the canvas with device-pixel-ratio resolution for crisp rendering,
  // while the CSS size stays at the logical viewport size.
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined;

  await page.render({ canvasContext: ctx, viewport, transform }).promise;

  return viewport;
}
