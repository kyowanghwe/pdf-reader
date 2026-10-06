# PDF Reader

A web-based PDF reader with highlight-based progress tracking. Read a PDF in the
browser, select text to create colored highlights, and reopen the document later
to see the highlight list and jump straight back to where you left off.

- **Frontend:** React + Vite + TypeScript + raw PDF.js, hosted on **GitHub Pages**.
- **API:** a single **Cloudflare Worker** over **R2** (PDF files) and **KV**
  (highlights + progress).
- **Auth (v1):** a per-browser random `userId` in `localStorage`, sent as the
  `X-User-Id` header on every request. No login.

```
GitHub Pages (React) --HTTPS--> Cloudflare Worker --> R2 (PDFs) + KV (highlights/progress)
```

## Repo layout

```
pdf-reader/
├── web/                    # React + Vite frontend -> GitHub Pages
├── worker/                 # Cloudflare Worker (R2 + KV) + wrangler.toml
├── .github/workflows/deploy.yml
├── .gitignore
└── README.md
```

## How it works

- `fileHash` is the hex SHA-256 of the raw PDF bytes, computed in the browser.
  It is the stable key for a document and for its highlights + progress.
- Highlight rectangles are stored normalized to `[0,1]` of the page size, so
  changing zoom keeps overlays aligned to the same text.
- R2 object key: `user/<userId>/<fileHash>.pdf`. KV keys:
  `doc:<userId>:<fileHash>`, `hl:<userId>:<fileHash>`, `prog:<userId>:<fileHash>`.

---

## Local development

Two independent packages — run each in its own terminal.

### Worker (API)

```sh
cd worker
npm install
npx wrangler dev
```

`wrangler dev` emulates R2 + KV locally. Note the local URL it prints (usually
`http://127.0.0.1:8787`) for the `VITE_WORKER_URL` below.

### Web (frontend)

```sh
cd web
npm install
# point the app at your local Worker (PowerShell):
$env:VITE_WORKER_URL = "http://127.0.0.1:8787"
npm run dev
```

Open the Vite dev URL it prints. Uploading a PDF stores it in the local R2
emulation; highlights and progress round-trip through the local KV emulation.

> `VITE_WORKER_URL` is read by `web/src/api.ts` as the Worker API base URL.
> `VITE_BASE` sets the Vite `base` path for GitHub Pages (see deploy below).

---

## Cloudflare setup (deploy the Worker)

Install Wrangler and authenticate once (`npx wrangler login`), then:

1. **Create the R2 bucket** (matches `bucket_name` in `worker/wrangler.toml`):

   ```sh
   cd worker
   npx wrangler r2 bucket create pdf-reader-pdfs
   ```

2. **Create the KV namespace:**

   ```sh
   npx wrangler kv namespace create HL_KV
   ```

   This prints an `id`. Paste it into `worker/wrangler.toml`, replacing
   `<REPLACE_WITH_KV_ID>`:

   ```toml
   [[kv_namespaces]]
   binding = "HL_KV"
   id = "<the id printed above>"
   ```

3. **Set the allowed CORS origin.** In `worker/wrangler.toml`, set
   `ALLOWED_ORIGIN` to your GitHub Pages origin (not the full repo path), e.g.
   `https://<user>.github.io`. Keep `*` only for local testing.

4. **Deploy:**

   ```sh
   npx wrangler deploy
   ```

   Wrangler prints the Worker URL (e.g.
   `https://pdf-reader-worker.<your-subdomain>.workers.dev`). Use it as
   `VITE_WORKER_URL` for the frontend.

> Offline sanity check (no credentials, no deploy): `npx wrangler deploy --dry-run`.

---

## GitHub Pages setup (deploy the frontend)

1. Push this repo to GitHub.
2. **Settings -> Pages -> Build and deployment -> Source: GitHub Actions.**
3. **Settings -> Secrets and variables -> Actions -> Variables**, add:
   - `VITE_WORKER_URL` = the deployed Worker URL from the Cloudflare step.
   - `VITE_BASE` = `/<repo>/` for a project page
     (`https://<user>.github.io/<repo>/`), or `/` for a user/org page or a
     custom domain.
4. **Push to `main`.** The workflow in `.github/workflows/deploy.yml` builds
   `web/` and publishes `web/dist` to GitHub Pages.

After the first successful run, the app is live at your Pages URL. Make sure the
Worker's `ALLOWED_ORIGIN` matches that origin so CORS requests succeed.

---

## Copyright note

PDF files are **never committed to this repo**. They live only in your private
Cloudflare R2 bucket and are served solely to their owner through the Worker.
The `.gitignore` excludes `**/*.pdf` so no PDF is accidentally tracked. Keep it
that way to avoid redistributing copyrighted material.
