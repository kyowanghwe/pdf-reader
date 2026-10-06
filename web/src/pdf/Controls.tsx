// Top controls — prev/next navigation + zoom. The page indicator has moved
// to the bottom PageBar.

interface ControlsProps {
  numPages: number;
  currentPage: number;
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export function Controls({
  numPages,
  currentPage,
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
