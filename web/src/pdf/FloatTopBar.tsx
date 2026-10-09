// Floating annotation toolbar — pinned to the top edge of the PDF viewer area,
// overlaid on top of the scroll content. Can be toggled to a collapsed strip.

import { useState } from 'react';

interface FloatTopBarProps {
  onHighlight: () => void;
}

export function FloatTopBar({ onHighlight }: FloatTopBarProps) {
  const [visible, setVisible] = useState(true);
  const [showTip, setShowTip] = useState(false);

  const handleHighlight = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      setShowTip(true);
      window.setTimeout(() => setShowTip(false), 2000);
      return;
    }
    onHighlight();
  };

  if (!visible) {
    return (
      <div className="pdf-float-bar pdf-float-bar--top pdf-float-bar--collapsed">
        <button
          type="button"
          className="pdf-float-btn"
          onClick={() => setVisible(true)}
          aria-label="Show annotation toolbar"
          title="Show annotation toolbar"
        >
          ˅
        </button>
      </div>
    );
  }

  return (
    <div className="pdf-float-bar pdf-float-bar--top">
      <div className="pdf-float-tip-wrap">
        <button
          type="button"
          className="pdf-float-btn"
          onClick={handleHighlight}
          title="Highlight selected text"
        >
          🖊 Highlight
        </button>
        {showTip && (
          <span className="pdf-float-tip" role="status">
            Select text first
          </span>
        )}
      </div>
      <button type="button" className="pdf-float-btn" disabled title="Coming soon">
        ✏️
      </button>
      <button type="button" className="pdf-float-btn" disabled title="Coming soon">
        💬
      </button>
      <span className="pdf-float-spacer" aria-hidden="true" />
      <button
        type="button"
        className="pdf-float-btn pdf-float-btn--icon"
        onClick={() => setVisible(false)}
        aria-label="Hide toolbar"
        title="Hide toolbar"
      >
        ˄
      </button>
    </div>
  );
}
