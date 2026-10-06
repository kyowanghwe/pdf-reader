/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Cloudflare Worker API (set at build time). */
  readonly VITE_WORKER_URL?: string;
  /** GitHub Pages base path (handled in vite.config.ts; declared for completeness). */
  readonly VITE_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// PDF.js worker is imported as a URL asset via Vite's `?url` suffix.
declare module 'pdfjs-dist/build/pdf.worker.min.mjs?url' {
  const src: string;
  export default src;
}
