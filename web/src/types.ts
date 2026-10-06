// Shared data model. Mirrors the KV JSON shapes defined in PLAN.md / plan.md.

/** A rectangle normalized to page dimensions, each value in [0,1]. Zoom-safe. */
export interface NormalizedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Highlight {
  id: string;
  fileHash: string;
  /** 1-based page number. */
  page: number;
  rects: NormalizedRect[];
  /** The selected text, kept as a re-locate fallback. */
  text: string;
  color: string;
  note: string;
  createdAt: number;
}

export interface Document {
  fileHash: string;
  fileName: string;
  title: string;
  size: number;
  lastOpenedAt: number;
  lastHighlightId: string | null;
}

export interface Progress {
  fileHash: string;
  lastHighlightId: string | null;
  scrollTop: number;
  page: number;
}
