// Top toolbar: page navigation (prev/next) and zoom controls.

interface ControlsProps {
  currentPage: number;
  numPages: number;
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export function Controls({
  currentPage,
  numPages,
  scale,
  onZoomIn,
  onZoomOut,
  onPrev,
  onNext,
}: ControlsProps) {
  return (
    <div className="pdf-controls">
      <div className="pdf-controls-group">
        <button
          type="button"
          onClick={onPrev}
          disabled={currentPage <= 1}
          aria-label="Previous page"
        >
          ‹ Prev
        </button>
        <span className="pdf-zoom-indicator">
          {currentPage} / {numPages || 1}
        </span>
        <button
          type="button"
          onClick={onNext}
          disabled={currentPage >= numPages}
          aria-label="Next page"
        >
          Next ›
        </button>
      </div>
      <div className="pdf-controls-group">
        <button type="button" onClick={onZoomOut} aria-label="Zoom out">
          −
        </button>
        <span className="pdf-zoom-indicator">{Math.round(scale * 100)}%</span>
        <button type="button" onClick={onZoomIn} aria-label="Zoom in">
          +
        </button>
      </div>
    </div>
  );
}
