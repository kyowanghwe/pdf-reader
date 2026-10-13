// Jump to a highlight: scroll its page/rect into view, then flash the box.

import type { Highlight } from '../types';
import { pageContainerId } from '../pdf/PdfViewer';

const FLASH_CLASS = 'flash';
/** Keep in sync with the .highlight-box.flash animation duration in styles.css. */
const FLASH_MS = 1000;

/**
 * Scroll a highlight into view and briefly flash its overlay box.
 *
 * Always scrolls via the .pdf-scroll container directly — never via
 * scrollIntoView on the page element — to avoid triggering a window-level
 * scroll that would push the app header off-screen on mobile.
 */
export function jumpToHighlight(highlight: Highlight): void {
  const pageEl = document.getElementById(pageContainerId(highlight.page));
  if (!pageEl) return;

  const scroller = pageEl.closest<HTMLElement>('.pdf-scroll');
  const firstRect = highlight.rects[0];

  if (scroller) {
    // Compute intra-page rect offset when the canvas is already rendered.
    const renderedHeight = pageEl.getBoundingClientRect().height;
    const rectOffset =
      firstRect && renderedHeight > 0 ? firstRect.y * renderedHeight : 0;
    const target = pageEl.offsetTop - scroller.offsetTop + rectOffset - 24;
    scroller.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  } else {
    // Fallback: no .pdf-scroll ancestor (should not happen in normal use).
    pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Flash every overlay box belonging to this highlight.
  const boxes = pageEl.querySelectorAll<HTMLElement>(
    `.highlight-box[data-highlight-id="${highlight.id}"]`,
  );
  boxes.forEach((box) => {
    box.classList.remove(FLASH_CLASS);
    // Force reflow so re-adding the class restarts the animation.
    void box.offsetWidth;
    box.classList.add(FLASH_CLASS);
    window.setTimeout(() => box.classList.remove(FLASH_CLASS), FLASH_MS);
  });
}
