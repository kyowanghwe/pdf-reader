// Floating navigation + zoom bar — pinned to the bottom edge of the PDF viewer
// area, overlaid on scroll content. The page number is clickable:
//   click → inline number input pre-filled with current page
//   Enter  → jump to clamped page
//   Escape / blur → cancel (restore display)
// Also contains the eye-protection (White/Green) theme toggle.

import { useRef, useState } from 'react';
import type { Theme } from '../theme';

interface FloatBottomBarProps {
  currentPage: number;
  numPages: number;
  scale: number;
  theme: Theme;
  onPrev: () => void;
  onNext: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onGoToPage: (page: number) => void;
  onToggleTheme: () => void;
}

export function FloatBottomBar({
  currentPage,
  numPages,
  scale,
  theme,
  onPrev,
  onNext,
  onZoomIn,
  onZoomOut,
  onGoToPage,
  onToggleTheme,
}: FloatBottomBarProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setDraft(String(currentPage));
    setEditing(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  const commit = () => {
    const n = parseInt(draft, 10);
    if (Number.isFinite(n)) {
      onGoToPage(Math.max(1, Math.min(numPages, n)));
    }
    setEditing(false);
  };

  const cancel = () => setEditing(false);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  return (
    <div className="pdf-float-bar pdf-float-bar--bottom">
      {/* Navigation group: Prev | page display/input | Next */}
      <div className="pdf-float-group">
        <button
          type="button"
          className="pdf-float-btn"
          onClick={onPrev}
          disabled={currentPage <= 1}
          aria-label="Previous page"
        >
          ‹ Prev
        </button>

        <div className="pdf-float-page">
          {editing ? (
            <input
              ref={inputRef}
              type="number"
              inputMode="numeric"
              className="pdf-page-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={cancel}
              min={1}
              max={numPages}
              aria-label="Go to page"
            />
          ) : (
            <button
              type="button"
              className="pdf-page-display"
              onClick={startEdit}
              aria-label={`Page ${currentPage}, click to jump`}
              title="Click to jump to page"
            >
              {currentPage}
            </button>
          )}
          <span className="pdf-float-page-sep">/ {numPages || 1}</span>
        </div>

        <button
          type="button"
          className="pdf-float-btn"
          onClick={onNext}
          disabled={currentPage >= numPages}
          aria-label="Next page"
        >
          Next ›
        </button>
      </div>

      {/* Zoom group */}
      <div className="pdf-float-group">
        <button
          type="button"
          className="pdf-float-btn pdf-float-btn--icon"
          onClick={onZoomOut}
          aria-label="Zoom out"
        >
          −
        </button>
        <span className="pdf-float-zoom">{Math.round(scale * 100)}%</span>
        <button
          type="button"
          className="pdf-float-btn pdf-float-btn--icon"
          onClick={onZoomIn}
          aria-label="Zoom in"
        >
          +
        </button>
      </div>

      {/* Eye-protection theme toggle */}
      <button
        type="button"
        className={`pdf-float-btn pdf-float-btn--icon${theme === 'green' ? ' is-active' : ''}`}
        onClick={onToggleTheme}
        aria-pressed={theme === 'green'}
        aria-label={theme === 'green' ? 'Disable eye protection (switch to White)' : 'Enable eye protection (switch to Green)'}
        title={theme === 'green' ? 'Eye protection ON — click to turn off' : 'Eye protection OFF — click to turn on'}
      >
        👁
      </button>
    </div>
  );
}
