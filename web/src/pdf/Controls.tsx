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
        <button type="button" onClick={onPrev} disabled={currentPage <= 1}>
          Prev
        </button>
        <span className="pdf-page-indicator">
          Page {currentPage} / {numPages}
        </span>
        <button
          type="button"
          onClick={onNext}
          disabled={currentPage >= numPages}
        >
          Next
        </button>
      </div>
      <div className="pdf-controls-group">
        <button type="button" onClick={onZoomOut}>
          −
        </button>
        <span className="pdf-zoom-indicator">{Math.round(scale * 100)}%</span>
        <button type="button" onClick={onZoomIn}>
          +
        </button>
      </div>
    </div>
  );
}
