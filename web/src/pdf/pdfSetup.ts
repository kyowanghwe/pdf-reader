import * as pdfjs from 'pdfjs-dist';
// Vite resolves this to a hashed asset URL for the PDF.js worker.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// PDF.js v4 requires the worker to be wired explicitly.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };
