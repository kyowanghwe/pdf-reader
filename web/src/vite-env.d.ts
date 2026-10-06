/// <reference types="vite/client" />

interface ImportMetaEnv {
  // No VITE_WORKER_URL or VITE_BASE — the app is same-origin on Cloudflare Pages.
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// PDF.js worker is imported as a URL asset via Vite's `?url` suffix.
declare module 'pdfjs-dist/build/pdf.worker.min.mjs?url' {
  const src: string;
  export default src;
}
