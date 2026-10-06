// Convert the current DOM Selection into zoom-safe normalized highlight rects.
//
// Each selection client rect is mapped into the coordinate space of the
// `.pdf-page` container it falls on, then normalized to that container's CSS
// pixel size so rects live in [0,1] and survive zoom changes (PLAN.md phase 3).

import type { NormalizedRect } from '../types';

/** One page's worth of a selection: its page number and normalized rects. */
export interface SelectionResult {
  /** 1-based page number (from the page container's data-page-number). */
  page: number;
  rects: NormalizedRect[];
  /** The selected text for this page (used as a re-locate fallback). */
  text: string;
}

/** Find the enclosing `.pdf-page` element for a node, if any. */
function pageElementOf(node: Node | null): HTMLElement | null {
  let el: Node | null = node;
  while (el && el.nodeType !== Node.ELEMENT_NODE) {
    el = el.parentNode;
  }
  const element = el as HTMLElement | null;
  return element?.closest<HTMLElement>('.pdf-page') ?? null;
}

/**
 * Read `window.getSelection()` and produce one SelectionResult per page the
 * selection touches. Returns an empty array when the selection is empty or
 * does not land inside a rendered page.
 */
export function fromSelection(): SelectionResult[] {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return [];
  }

  const text = selection.toString();
  if (!text.trim()) return [];

  // Group client rects by the page element that contains each range.
  const perPage = new Map<HTMLElement, DOMRect[]>();

  for (let i = 0; i < selection.rangeCount; i += 1) {
    const range = selection.getRangeAt(i);
    // Prefer the page that physically contains the range's start/end nodes.
    const pageEl =
      pageElementOf(range.startContainer) ?? pageElementOf(range.endContainer);
    if (!pageEl) continue;

    const clientRects = Array.from(range.getClientRects()).filter(
      (r) => r.width > 0 && r.height > 0,
    );
    if (clientRects.length === 0) continue;

    const existing = perPage.get(pageEl) ?? [];
    existing.push(...clientRects);
    perPage.set(pageEl, existing);
  }

  const results: SelectionResult[] = [];

  for (const [pageEl, clientRects] of perPage) {
    const page = Number(pageEl.dataset.pageNumber);
    if (!Number.isFinite(page) || page < 1) continue;

    const pageBox = pageEl.getBoundingClientRect();
    const pageCssW = pageBox.width;
    const pageCssH = pageBox.height;
    if (pageCssW <= 0 || pageCssH <= 0) continue;

    const rects: NormalizedRect[] = clientRects.map((r) => ({
      x: (r.left - pageBox.left) / pageCssW,
      y: (r.top - pageBox.top) / pageCssH,
      w: r.width / pageCssW,
      h: r.height / pageCssH,
    }));

    results.push({ page, rects, text });
  }

  return results.sort((a, b) => a.page - b.page);
}
