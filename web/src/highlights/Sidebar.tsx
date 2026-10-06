// Sidebar listing a document's highlights with color controls and jump/delete.

import type { Highlight } from '../types';

/** Preset colors offered when creating or recoloring a highlight. */
export const HIGHLIGHT_COLORS = [
  '#fde047', // yellow
  '#86efac', // green
  '#93c5fd', // blue
  '#f9a8d4', // pink
  '#fdba74', // orange
] as const;

interface SidebarProps {
  highlights: Highlight[];
  /** Currently selected color for new highlights. */
  activeColor: string;
  onActiveColorChange: (color: string) => void;
  onJump: (highlight: Highlight) => void;
  onRecolor: (id: string, color: string) => void;
  onDelete: (id: string) => void;
}

function snippet(text: string, max = 80): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

export function Sidebar({
  highlights,
  activeColor,
  onActiveColorChange,
  onJump,
  onRecolor,
  onDelete,
}: SidebarProps) {
  return (
    <aside className="highlight-sidebar">
      <div className="highlight-sidebar-header">
        <h2>Highlights</h2>
        <div className="color-picker" role="radiogroup" aria-label="Highlight color">
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`color-swatch${color === activeColor ? ' is-active' : ''}`}
              style={{ backgroundColor: color }}
              aria-label={`Use color ${color}`}
              aria-pressed={color === activeColor}
              onClick={() => onActiveColorChange(color)}
            />
          ))}
        </div>
      </div>

      {highlights.length === 0 ? (
        <p className="highlight-empty">
          Select text in the document and it will be highlighted here.
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
                <select
                  className="highlight-recolor"
                  value={h.color}
                  aria-label="Change highlight color"
                  onChange={(e) => onRecolor(h.id, e.target.value)}
                >
                  {HIGHLIGHT_COLORS.map((color) => (
                    <option key={color} value={color}>
                      {color}
                    </option>
                  ))}
                </select>
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
