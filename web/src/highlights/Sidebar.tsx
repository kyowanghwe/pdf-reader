// Right sidebar listing a document's highlights, with jump + delete.
// Yellow-only: no color picker, no recolor control.

import type { Highlight } from '../types';

interface SidebarProps {
  highlights: Highlight[];
  onJump: (highlight: Highlight) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

function snippet(text: string, max = 80): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

export function Sidebar({ highlights, onJump, onDelete, onClose }: SidebarProps) {
  return (
    <aside className="highlight-sidebar">
      <div className="highlight-sidebar-header">
        <h2>Highlights</h2>
        <button
          type="button"
          className="highlight-sidebar-close"
          onClick={onClose}
          aria-label="Close highlights panel"
          title="Close highlights panel"
        >
          ×
        </button>
      </div>

      {highlights.length === 0 ? (
        <p className="highlight-empty">
          Select text and click Highlight to save it here.
        </p>
      ) : (
        <ul className="highlight-list">
          {highlights.map((h) => (
            <li key={h.id} className="highlight-item">
              <button
                type="button"
                className="highlight-item-main"
                onClick={() => onJump(h)}
                title="Jump to highlight"
              >
                <span
                  className="color-swatch sm"
                  style={{ backgroundColor: h.color }}
                  aria-hidden="true"
                />
                <span className="highlight-text">{snippet(h.text)}</span>
                <span className="highlight-page">p.{h.page}</span>
              </button>
              <div className="highlight-item-actions">
                <button
                  type="button"
                  className="highlight-delete"
                  onClick={() => onDelete(h.id)}
                  aria-label="Delete highlight"
                  title="Delete highlight"
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
