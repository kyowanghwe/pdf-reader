# PDF Reader — Project Plan

A web-based PDF reader with highlight-based progress tracking. Read a PDF in the
browser, select text to create yellow highlights, and reopen the document later
to see the highlight list and jump straight back to where you left off.

## Goals

- Render PDFs in the browser with a clean, WPS-like reading interface.
- Select text to create yellow highlights via a floating popup.
- Persist highlights so they restore when the same file is reopened.
- Show a toggleable highlight sidebar; click one to jump to that spot.
- Resume reading from the last position ("where you left off").
- Keep PDFs **private** with Cloudflare Access (Zero Trust) authentication.

## Architecture

Same-origin Cloudflare Pages serving both the SPA and the API:

```
┌──────────────────────────────────────────────────────────┐
│                   Cloudflare Pages                        │
│  /              → React + Vite SPA (web/dist)             │
│  /api/*         → Pages Function → Worker handler logic   │
│  Session cookie → Cloudflare Access (Zero Trust)          │
└───────────┬──────────────────────────┬────────────────────┘
            │                          │
    ┌───────▼────────┐         ┌───────▼────────┐
    │  R2 bucket     │         │  KV namespace  │
    │  (PDF files)   │         │  (highlights)  │
    └────────────────┘         └────────────────┘
```

| Layer | Service | Role |
|---|---|---|
| Frontend | Cloudflare Pages | Serves the static React app from web/dist. |
| API | Cloudflare Pages Functions | Single catch-all function at /api/* delegating to handler logic. |
| PDF storage | Cloudflare R2 | Stores private PDF files; handler gates access by identity. |
| Highlight storage | Cloudflare KV | Highlights + progress, keyed by identity + file hash. |
| Auth | Cloudflare Access (Zero Trust) | JWT-based authentication; identity from the verified email. |

## Tech Stack

- **Frontend:** React + Vite + TypeScript
- **PDF rendering:** PDF.js (raw, for full control over the text layer and highlight rects)
- **Backend:** Cloudflare Pages Functions (catch-all /api/*) importing worker handler
- **Storage:** R2 (PDF files), KV (highlights + progress)
- **Auth:** Cloudflare Access (Zero Trust) — JWT verification via WebCrypto RS256 (no JOSE library)
- **Hosting:** Cloudflare Pages (single origin for SPA + API)
- **CI/CD:** GitHub Actions + `wrangler pages deploy`

## Why This Design

- **Same-origin** eliminates all CORS complexity and makes the Access session
  cookie first-party (no third-party cookie blocking issues).
- **Where the PDF lives is independent of highlights.** Highlights are keyed by the
  file's content hash (`fileHash`), so reopening the same file always restores the
  same highlights and jump-back position.
- **PDFs stay private in R2**, served only to the authenticated user through the handler.
- **Cloudflare Access** provides real authentication without building a login form.
  The team domain + AUD are non-secret config.
- **Free tiers** cover a personal workload (Pages free; R2 10 GB, no egress fees; KV
  free tier; Access free for up to 50 users).

## Data Model

```
Document  { fileHash, fileName, title, size, lastOpenedAt, lastHighlightId }
Highlight { id, fileHash, page, rects[], text, color, note, createdAt }
Progress  { fileHash, lastHighlightId, scrollTop, page }
```

- `rects[]` are normalized to page dimensions so zoom does not break positions.
- `text` is stored as a fallback for re-locating a highlight if layout shifts.
- `color` field is always `#fde047` (yellow) for new highlights; kept in the model
  for backward compatibility.

## API (Pages Function → handler)

All routes require a valid Cloudflare Access JWT (`Cf-Access-Jwt-Assertion` header).
No CORS (same-origin). Identity is derived from the verified JWT email.

```
GET    /api/whoami                             signed-in email
POST   /api/pdfs                               upload (body = file)
GET    /api/pdfs                               list my PDFs (metadata)
GET    /api/pdfs/:fileHash                     stream PDF bytes
DELETE /api/pdfs/:fileHash                     delete PDF + its highlights

GET    /api/documents/:fileHash/highlights     list highlights
POST   /api/documents/:fileHash/highlights     create highlight
PUT    /api/highlights/:id                      edit (backward compat, unused by UI)
DELETE /api/highlights/:id                      delete

PUT    /api/documents/:fileHash/progress        save last-read position
```

## Auth

Cloudflare Access (Zero Trust) JWT verification on every route:

1. Extract `Cf-Access-Jwt-Assertion` header.
2. Verify RS256 signature against team JWKS (module-level cache, fail-closed).
3. Validate `aud` (contains ACCESS_AUD), `exp`, `iss`.
4. Extract `email` → derive `identity` via `emailToIdentity(email)`.
5. Dev bypass: `DEV_BYPASS=true` in `.dev.vars` → fixed `dev@local` identity.

Identity derivation: `email.toLowerCase().replace(/@/g, '_at_').replace(/\./g, '_')`.

Storage keys:
- R2: `user/<identity>/<fileHash>.pdf`
- KV: `doc:<identity>:<fileHash>`, `hl:<identity>:<fileHash>`, `prog:<identity>:<fileHash>`

## Repo Layout

```
pdf-reader/
├── web/                      # React + Vite frontend → Cloudflare Pages
│   ├── src/
│   │   ├── App.tsx
│   │   ├── api.ts            # calls the API (same-origin /api/*)
│   │   ├── identity.ts       # /api/whoami → signed-in email
│   │   ├── theme.ts          # White/Green localStorage theme
│   │   ├── pdf/              # PDF.js render + text layer + outline sidebar + page bar
│   │   ├── highlights/       # selection popup → rects → overlay → jump
│   │   └── library/          # upload, list, open
│   └── vite.config.ts        # base '/', dev proxy to :8788
├── worker/                   # Handler logic (imported by Pages Function)
│   └── src/
│       ├── handler.ts        # router: auth → R2 + KV
│       ├── auth.ts           # JWT verification + dev bypass + emailToIdentity
│       └── env.ts            # shared Env interface
├── functions/                # Cloudflare Pages Functions
│   └── api/[[route]].ts      # catch-all → handleRequest
├── wrangler.toml             # Pages config (R2 + KV bindings, Access vars)
├── .dev.vars                 # Local dev bypass (gitignored)
├── .github/workflows/deploy.yml  # wrangler pages deploy
└── README.md                 # setup + deploy steps
```

## UI Features

- **Left outline sidebar:** collapsible chapter tree from PDF outline (doc.getOutline()), with "No chapters available" fallback.
- **Bottom page bar:** current page / total pages, tabular-nums.
- **Selection popup:** yellow-only highlight via a floating "Highlight" button near the selection.
- **Right highlight sidebar:** toggleable list of highlights, click-to-jump + flash, delete.
- **Theme switcher:** White (default) + Green (eye-protection tint via mix-blend-mode overlay).
- **Identity display:** "Signed in as <email> · Sign out" in the header.
- **Library home:** list uploaded PDFs, upload new, open, delete.

## Build Phases (completed)

| Phase | Deliverable |
|---|---|
| 1. Scaffold | `web/` + `worker/`; Vite + PDF.js wired; handler router. |
| 2. PDF render | Upload/pick → render pages + text layer; zoom; page nav. |
| 3. Highlights | Selection → normalized rects → yellow overlay → sidebar list → click-to-jump + flash. |
| 4. Progress | Save/restore last position; "Resume where you left off." |
| 5. Same-origin migration | Cloudflare Pages + Pages Functions; remove CORS; /api/* same-origin. |
| 6. Access auth | JWT verification; identity-keyed storage; dev bypass. |
| 7. WPS-like UI | Outline sidebar, bottom page bar, selection popup, highlight sidebar toggle, themes. |
| 8. Deploy | `wrangler pages deploy`; GitHub Actions workflow; README with Access setup. |

## Open / Future Enhancements

- Offline-first: IndexedDB cache that syncs to the Worker.
- Notes and tags per highlight; export/import highlights as JSON.
- Optional Google Drive (OAuth + Picker) as an alternative private source.
- Custom domain setup.
