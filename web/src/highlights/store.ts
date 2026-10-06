// Highlights + progress store, keyed by fileHash.
//
// FEAT-004: the backing is now the Cloudflare Worker (R2 + KV via api.ts). The
// public action interface below is the SAME one FEAT-003 defined — identical
// names/signatures — so consumers (App.tsx, Sidebar, jump) are unchanged.
//
// Design: local reactive state remains the source of truth for rendering so the
// synchronous getters/`addHighlight` return value stay valid. Mutations update
// local state optimistically AND fire the matching Worker call; `loadDocument`
// hydrates local state from the Worker when a document opens.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Document, Highlight, NormalizedRect, Progress } from '../types';
import * as api from '../api';

/** Input needed to create a highlight (ids/timestamps are assigned by the store). */
export interface NewHighlight {
  fileHash: string;
  page: number;
  rects: NormalizedRect[];
  text: string;
  color: string;
  note?: string;
}

/** Fields that may be patched on an existing highlight. */
export interface HighlightPatch {
  color?: string;
  note?: string;
}

/**
 * Stable store action interface (unchanged from FEAT-003). Now backed by the
 * Worker; consumers depend only on these names/signatures.
 */
export interface HighlightStore {
  /** All highlights for a document, in creation order. */
  getHighlights(fileHash: string): Highlight[];
  /** Create a highlight; returns the stored record (with id/createdAt). */
  addHighlight(input: NewHighlight): Highlight;
  /** Patch color and/or note on an existing highlight. */
  updateHighlight(id: string, patch: HighlightPatch): void;
  /** Delete a highlight by id. */
  removeHighlight(id: string): void;
  /** Save reading progress for a document. */
  setProgress(progress: Progress): void;
  /** Read saved progress for a document, or null if none. */
  getProgress(fileHash: string): Progress | null;
  /**
   * Hydrate highlights for a document from the Worker. If the document's
   * metadata is passed, its lastHighlightId seeds resume progress (the Worker
   * exposes no standalone GET-progress route; progress is restored from the
   * Document's lastHighlightId recorded on each saveProgress).
   */
  loadDocument(fileHash: string, doc?: Document | null): Promise<void>;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `hl-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Logs a Worker call failure without disrupting the optimistic local update. */
function reportError(action: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[highlights] ${action} failed: ${message}`);
}

/**
 * Hook providing a Worker-backed HighlightStore plus the reactive maps that
 * components read to re-render. The `store` object identity is stable.
 */
export function useHighlightStore(): {
  store: HighlightStore;
  highlights: Record<string, Highlight[]>;
  progress: Record<string, Progress>;
} {
  const [highlights, setHighlights] = useState<Record<string, Highlight[]>>({});
  const [progress, setProgress] = useState<Record<string, Progress>>({});

  // Keep refs so action callbacks can read current state synchronously
  // (e.g. getHighlights/getProgress) without being recreated.
  const highlightsRef = useRef(highlights);
  highlightsRef.current = highlights;
  const progressRef = useRef(progress);
  progressRef.current = progress;

  // Track which docs have been hydrated to avoid redundant Worker fetches.
  const loadedRef = useRef<Set<string>>(new Set());

  const getHighlights = useCallback(
    (fileHash: string): Highlight[] => highlightsRef.current[fileHash] ?? [],
    [],
  );

  const loadDocument = useCallback(
    async (fileHash: string, doc?: Document | null): Promise<void> => {
      try {
        const list = await api.listHighlights(fileHash);
        setHighlights((prev) => ({ ...prev, [fileHash]: list }));
      } catch (err) {
        reportError('loadDocument', err);
        // Ensure the doc has an entry so the UI shows an empty list, not stale data.
        setHighlights((prev) => ({ ...prev, [fileHash]: prev[fileHash] ?? [] }));
      } finally {
        loadedRef.current.add(fileHash);
      }

      // Seed resume progress from the Document metadata when available. The
      // lastHighlightId lets the UI offer "resume where you left off".
      if (doc && doc.lastHighlightId) {
        setProgress((prev) => {
          if (prev[fileHash]) return prev; // don't clobber a fresher in-session value
          return {
            ...prev,
            [fileHash]: {
              fileHash,
              lastHighlightId: doc.lastHighlightId,
              scrollTop: 0,
              page: 1,
            },
          };
        });
      }
    },
    [],
  );

  const addHighlight = useCallback((input: NewHighlight): Highlight => {
    // Optimistic local record; the Worker also assigns an id, but local state is
    // the render source of truth so we keep this one and reconcile on next load.
    const record: Highlight = {
      id: newId(),
      fileHash: input.fileHash,
      page: input.page,
      rects: input.rects,
      text: input.text,
      color: input.color,
      note: input.note ?? '',
      createdAt: Date.now(),
    };
    setHighlights((prev) => {
      const list = prev[record.fileHash] ?? [];
      return { ...prev, [record.fileHash]: [...list, record] };
    });

    // Persist to the Worker; on success swap the optimistic id for the server id.
    api
      .createHighlight(input.fileHash, {
        page: input.page,
        rects: input.rects,
        text: input.text,
        color: input.color,
        note: input.note,
      })
      .then((created) => {
        setHighlights((prev) => {
          const list = prev[input.fileHash] ?? [];
          return {
            ...prev,
            [input.fileHash]: list.map((h) => (h.id === record.id ? created : h)),
          };
        });
      })
      .catch((err) => reportError('createHighlight', err));

    return record;
  }, []);

  const updateHighlight = useCallback((id: string, patch: HighlightPatch): void => {
    let fileHash: string | null = null;
    setHighlights((prev) => {
      const next: Record<string, Highlight[]> = {};
      let changed = false;
      for (const [hash, list] of Object.entries(prev)) {
        const updated = list.map((h) => {
          if (h.id !== id) return h;
          changed = true;
          fileHash = hash;
          return {
            ...h,
            color: patch.color ?? h.color,
            note: patch.note ?? h.note,
          };
        });
        next[hash] = updated;
      }
      return changed ? next : prev;
    });

    if (fileHash) {
      api
        .updateHighlight(id, fileHash, patch)
        .catch((err) => reportError('updateHighlight', err));
    }
  }, []);

  const removeHighlight = useCallback((id: string): void => {
    let fileHash: string | null = null;
    setHighlights((prev) => {
      const next: Record<string, Highlight[]> = {};
      let changed = false;
      for (const [hash, list] of Object.entries(prev)) {
        const filtered = list.filter((h) => h.id !== id);
        if (filtered.length !== list.length) {
          changed = true;
          fileHash = hash;
        }
        next[hash] = filtered;
      }
      return changed ? next : prev;
    });

    if (fileHash) {
      api
        .deleteHighlight(id, fileHash)
        .catch((err) => reportError('deleteHighlight', err));
    }
  }, []);

  const setProgressAction = useCallback((p: Progress): void => {
    setProgress((prev) => ({ ...prev, [p.fileHash]: p }));
    api.saveProgress(p.fileHash, p).catch((err) => reportError('saveProgress', err));
  }, []);

  const getProgress = useCallback(
    (fileHash: string): Progress | null => progressRef.current[fileHash] ?? null,
    [],
  );

  const store = useMemo<HighlightStore>(
    () => ({
      getHighlights,
      addHighlight,
      updateHighlight,
      removeHighlight,
      setProgress: setProgressAction,
      getProgress,
      loadDocument,
    }),
    [
      getHighlights,
      addHighlight,
      updateHighlight,
      removeHighlight,
      setProgressAction,
      getProgress,
      loadDocument,
    ],
  );

  return { store, highlights, progress };
}

const HighlightStoreContext = createContext<HighlightStore | null>(null);

export const HighlightStoreProvider = HighlightStoreContext.Provider;

/** Access the store from any descendant. Throws if no provider is mounted. */
export function useHighlights(): HighlightStore {
  const store = useContext(HighlightStoreContext);
  if (!store) {
    throw new Error('useHighlights must be used within a HighlightStoreProvider');
  }
  return store;
}
