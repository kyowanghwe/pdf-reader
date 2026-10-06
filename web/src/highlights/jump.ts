// Jump to a highlight: scroll its page/rect into view, then flash the box.

import type { Highlight } from '../types';
import { pageContainerId } from '../pdf/PdfViewer';

const FLASH_CLASS = 'flash';
/** Keep in sync with the .highlight-box.flash animation duration in styles.css. */
const FLASH_MS = 1000;

/**
 * Scroll a highlight into view and briefly flash its overlay box.
 *
 * Steps: find the page container, scroll it into view, compute the rect's pixel
 * position at the current rendered size, scroll so the rect is visible, then add
 * a CSS flash class to the overlay box for ~1s and remove it.
 */
export function jumpToHighlight(highlight: Highlight): void {
  const pageEl = document.getElementById(pageContainerId(highlight.page));
  if (!pageEl) return;

  // Bring the page into view first.
  pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Then nudge so the first rect is visible, computed at the current size.
  const firstRect = highlight.rects[0];
  if (firstRect) {
    const renderedHeight = pageEl.getBoundingClientRect().height;
    const scroller = pageEl.closest<HTMLElement>('.pdf-scroll');
    if (scroller && renderedHeight > 0) {
      const rectTopInPage = firstRect.y * renderedHeight;
      // Target: a little above the rect so it is comfortably in view.
      const target =
        pageEl.offsetTop - scroller.offsetTop + rectTopInPage - 24;
      scroller.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }
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
