// Bottom status bar showing the current page position within the document.

interface PageBarProps {
  currentPage: number;
  numPages: number;
}

export function PageBar({ currentPage, numPages }: PageBarProps) {
  return (
    <div className="pdf-page-bar">
      Page {currentPage} of {numPages || 1}
    </div>
  );
}
