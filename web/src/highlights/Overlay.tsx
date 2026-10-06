// Draws a page's highlights as absolutely-positioned colored boxes.
//
// Rects are stored normalized in [0,1]; they are reconstructed against the
// current rendered page size (CSS px) so overlays stay aligned at any zoom.

import type { CSSProperties } from 'react';
import type { Highlight } from '../types';

interface OverlayProps {
  /** Highlights belonging to this page. */
  highlights: Highlight[];
  /** Current rendered page width in CSS pixels. */
  renderedWidth: number;
  /** Current rendered page height in CSS pixels. */
  renderedHeight: number;
}

/** Fill opacity applied to each highlight box's background color. */
const HIGHLIGHT_OPACITY = 0.35;

export function Overlay({ highlights, renderedWidth, renderedHeight }: OverlayProps) {
  if (renderedWidth <= 0 || renderedHeight <= 0) return null;

  return (
    <div className="highlight-overlay">
      {highlights.map((h) =>
        h.rects.map((rect, i) => {
          const style: CSSProperties = {
            left: rect.x * renderedWidth,
            top: rect.y * renderedHeight,
            width: rect.w * renderedWidth,
            height: rect.h * renderedHeight,
            backgroundColor: h.color,
            opacity: HIGHLIGHT_OPACITY,
          };
          return (
            <div
              key={`${h.id}-${i}`}
              className="highlight-box"
              data-highlight-id={h.id}
              style={style}
            />
          );
        }),
      )}
    </div>
  );
}
