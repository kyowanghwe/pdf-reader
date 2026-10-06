// Floating popup shown near a text selection with a single yellow Highlight
// button. Clicking it creates the highlight(s) for the selection.

/** Canonical yellow highlight color. */
export const HIGHLIGHT_YELLOW = '#fde047';

interface SelectionPopupProps {
  /** Fixed-position coordinates (viewport px) for the popup. */
  pos: { x: number; y: number };
  onHighlight: () => void;
}

export function SelectionPopup({ pos, onHighlight }: SelectionPopupProps) {
  return (
    <div
      className="selection-popup"
      style={{ left: pos.x, top: pos.y }}
      // Keep mousedown inside the popup from clearing the selection/popup.
      onMouseDown={(e) => e.preventDefault()}
    >
      <span
        className="selection-popup-swatch"
        style={{ backgroundColor: HIGHLIGHT_YELLOW }}
        aria-hidden="true"
      />
      <button type="button" className="selection-popup-btn" onClick={onHighlight}>
        Highlight
      </button>
    </div>
  );
}
