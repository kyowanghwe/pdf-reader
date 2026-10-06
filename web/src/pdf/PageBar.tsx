// Bottom page indicator — shows `currentPage / numPages`.

interface PageBarProps {
  currentPage: number;
  numPages: number;
}

export function PageBar({ currentPage, numPages }: PageBarProps) {
  return (
    <div className="pdf-page-bar">
      {currentPage} / {numPages}
    </div>
  );
}
