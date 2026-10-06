# PDF Reader — Project Plan

A web-based PDF reader with highlight-based progress tracking. Create highlights
while reading; reopen a document later to see the highlight list and jump straight
back to where you left off.

## Goals

- Render PDFs in the browser.
- Select text to create colored highlights.
- Persist highlights so they restore when the same file is reopened.
- Show a highlight list; click one to jump to that spot.
- Resume reading from the last position ("where you left off").
- Keep PDFs **private** (no public redistribution, no copyright exposure).

## Architecture

```
┌──────────────────────┐       ┌───────────────────────────┐
│   GitHub Pages        │       │   Cloudflare Worker       │
│  (public repo)        │ HTTPS │   (single API)            │
│  React + Vite + PDF.js│ ────> │                           │
└──────────────────────┘       │  /api/pdfs       (R2)      │
                                │  /api/highlights (KV)      │
                                └──────┬──────────────┬──────┘
                                       │              │
                               ┌───────▼────┐  ┌──────▼───────┐
                               │ R2 bucket  │  │ KV namespace │
                               │ (PDF files)│  │ (highlights) │
                               └────────────┘  └──────────────┘
```

| Layer | Service | Role |
|---|---|---|
| Frontend | GitHub Pages (public repo) | Serves the static React app over HTTPS, free. |
| API | Cloudflare Worker | One API for PDFs + highlights; handles CORS. |
| PDF storage | Cloudflare R2 | Stores private PDF files; Worker gates access by user. |
| Highlight storage | Cloudflare KV | Stores highlights + progress, keyed by user + file hash. |

## Tech Stack

- **Frontend:** React + Vite + TypeScript
- **PDF rendering:** PDF.js (raw, for full control over the text layer and highlight rects)
- **Worker:** TypeScript, deployed with Wrangler
- **Storage:** R2 (PDF files), KV (highlights + progress)
- **Hosting:** GitHub Pages (frontend), Cloudflare (Worker + storage)

## Why This Design

- **Where the PDF lives is independent of highlights.** Highlights are keyed by the
  file's content hash (`fileHash`), so reopening the same file always restores the
  same highlights and jump-back position.
- **PDFs stay private in R2**, served only to their owner through the Worker. No public
  repo hosting of copyrighted files, so no redistribution/copyright problem.
- **Clean CORS**: the Worker serves both PDF bytes and highlight data with the right
  headers for the GitHub Pages origin.
- **Free tiers** cover a personal workload (Pages free; Worker 100k req/day; R2 10 GB,
  no egress fees; KV free tier).

## Data Model

```
Document  { fileHash, fileName, title, size, lastOpenedAt, lastHighlightId }
Highlight { id, fileHash, page, rects[], text, color, note, createdAt }
Progress  { fileHash, lastHighlightId, scrollTop, page }
```

- `rects[]` are normalized to page dimensions so zoom does not break positions.
- `text` is stored as a fallback for re-locating a highlight if layout shifts.

## API (single Worker)

All routes require an `X-User-Id` header. CORS + `OPTIONS` preflight handled globally.

```
POST   /api/pdfs                               upload (body = file)
GET    /api/pdfs                               list my PDFs (metadata)
GET    /api/pdfs/:fileHash                     stream PDF bytes
DELETE /api/pdfs/:fileHash                     delete PDF + its highlights

GET    /api/documents/:fileHash/highlights     list highlights
POST   /api/documents/:fileHash/highlights     create highlight
PUT    /api/highlights/:id                      edit (color / note)
DELETE /api/highlights/:id                      delete

PUT    /api/documents/:fileHash/progress        save last-read position
```

### Key flows

**Upload a PDF**
1. Browser computes `fileHash` (SHA-256 of bytes).
2. `POST /api/pdfs` → Worker streams file into R2 at `user/<userId>/<fileHash>.pdf`,
   records metadata in KV.
3. Browser adds `fileHash` to its local library list.

**Open a PDF**
1. `GET /api/pdfs/<fileHash>` → Worker verifies `userId` owns it, streams bytes back.
2. PDF.js renders it.
3. `GET /api/documents/<fileHash>/highlights` → draw highlights, auto-scroll to last
   position.

## Repo Layout

```
pdf-reader/
├── web/                      # public → GitHub Pages
│   ├── src/
│   │   ├── App.tsx
│   │   ├── api.ts            # calls the Worker
│   │   ├── pdf/              # PDF.js render + text layer
│   │   ├── highlights/       # selection → rects → overlay → jump
│   │   ├── library/          # upload, list, open
│   │   └── userId.ts         # per-browser id (localStorage)
│   ├── index.html
│   └── vite.config.ts        # base path for Pages
├── worker/                   # Cloudflare Worker
│   ├── src/index.ts          # router: R2 + KV
│   └── wrangler.toml         # R2 + KV bindings, CORS origin
├── .github/workflows/deploy.yml   # build web → Pages
└── README.md                 # setup + deploy steps
```

## Build Phases

| Phase | Deliverable |
|---|---|
| 1. Scaffold | `web/` + `worker/`; Vite + PDF.js wired; Worker router skeleton with CORS. |
| 2. PDF render | Upload/pick → render pages + text layer; zoom; page nav (local first). |
| 3. Highlights | Selection → normalized rects → colored overlay → sidebar list → click-to-jump + flash. |
| 4. Progress | Save/restore last position; "Resume where you left off." |
| 5. Persist highlights | KV via Worker; per-browser `userId`. |
| 6. R2 for PDFs | Upload, list, stream, delete; browser library backed by R2. |
| 7. Deploy configs | Pages workflow + `wrangler.toml`; README with exact Cloudflare/GitHub steps. |

Phases 1–5 are built and verified locally (`wrangler dev` with local R2/KV emulation).
Cloud deploy (phase 7) needs a Cloudflare account + GitHub repo.

## Auth (v1)

Per-browser random `userId` stored in `localStorage` — no login. Keeps each browser's
PDFs and highlights separated. A real login is a later addition.

## Deployment (later, needs your accounts)

- **Frontend:** GitHub Actions builds `web/` and publishes to GitHub Pages on push to `main`.
- **Worker:** `wrangler deploy`; create the R2 bucket + KV namespace first (commands in README).
- No secrets in code; the Worker URL is a frontend env var.

## Open / Future Enhancements

- Real authentication (sign-in) instead of per-browser `userId`.
- Offline-first: IndexedDB cache that syncs to the Worker.
- Notes and tags per highlight; export/import highlights as JSON.
- Optional Google Drive (OAuth + Picker) as an alternative private source.
