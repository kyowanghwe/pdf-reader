# PDF Reader

A web-based PDF reader with Cloudflare Access authentication, yellow highlighting,
and WPS-like reading features. Read a PDF in the browser, select text to create
highlights via a floating popup, and reopen the document later to see the highlight
list and jump straight back to where you left off.

- **Frontend:** React + Vite + TypeScript + PDF.js, served from **Cloudflare Pages**.
- **API:** a catch-all Pages Function at `/api/*` delegating to the Worker handler
  logic over **R2** (PDF files) and **KV** (highlights + progress).
- **Auth:** **Cloudflare Access (Zero Trust)** — every `/api/*` request is gated by
  JWT verification. Identity is the verified email, used as the storage key. No
  `X-User-Id` header, no localStorage userId.

```
Cloudflare Pages (same origin)
├── /         → React SPA (web/dist)
├── /api/*    → Pages Function → handler (R2 + KV)
└── Session   → Cloudflare Access JWT (first-party cookie)
```

## Repo layout

```
pdf-reader/
├── web/                         # React + Vite frontend
├── worker/src/                  # handler.ts, auth.ts, env.ts (library, not deployed separately)
├── functions/api/[[route]].ts   # Pages Function catch-all
├── wrangler.toml                # Pages config (R2 + KV bindings, Access vars)
├── .dev.vars                    # Local dev bypass (gitignored)
├── package.json                 # Root: shared devDeps (wrangler, typescript, workers-types)
└── .github/workflows/deploy.yml # wrangler pages deploy
```

## How it works

- `fileHash` is the hex SHA-256 of the raw PDF bytes, computed in the browser.
  It is the stable key for a document and for its highlights + progress.
- Highlight rectangles are stored normalized to `[0,1]` of the page size, so
  changing zoom keeps overlays aligned to the same text.
- Identity is derived from the Access JWT email:
  `email.toLowerCase().replace(/@/g, '_at_').replace(/\./g, '_')`.
- R2 object key: `user/<identity>/<fileHash>.pdf`. KV keys:
  `doc:<identity>:<fileHash>`, `hl:<identity>:<fileHash>`, `prog:<identity>:<fileHash>`.
- `X-File-Hash` header carries the browser-sent hex SHA-256 on upload; the server
  checks for non-empty but does not re-validate it server-side.
- `TEAM_DOMAIN` and `ACCESS_AUD` are **non-secret** configuration vars (placed in
  `wrangler.toml` `[vars]`, not in secrets).

## Performance

Opening a PDF is fast because the app avoids two common bottlenecks:

**Lazy / virtualized page rendering**
Only the pages near the viewport are rendered (canvas + text layer). Pages outside
the visible area ± 2-page buffer are kept as correctly-sized placeholder divs —
so the scrollbar length, page positions, and jump-to-highlight all stay accurate
without rendering the entire document up front. Pages are promoted to full renders
by an `IntersectionObserver` as the user scrolls. Zooming re-renders visible pages
in place.

**HTTP range-request streaming**
The Worker's `GET /api/pdfs/:fileHash` supports `Range` requests and returns
`206 Partial Content` with exact `Content-Range` / `Content-Length` headers.
PDF.js loads the PDF by same-origin URL with `disableAutoFetch: true` and a
`rangeChunkSize`, so it fetches only the index and the byte ranges for the pages
it needs — typically a few hundred KB for page 1 — rather than downloading the
entire file. Repeat range fetches are cached with `Cache-Control: private, max-age=3600`.

**One known limitation:** if a PDF is not linearized ("fast web view" optimized),
PDF.js must fetch the cross-reference table before locating page 1, which can add
a small delay on the very first open of a large, non-linearized file. This is a
PDF format characteristic, not an app bug. See Troubleshooting below.

---

## Cloudflare Zero Trust / Access Setup

Before deploying, configure Cloudflare Access to protect the Pages site:

1. **Log in to the Cloudflare Zero Trust dashboard:** <https://one.dash.cloudflare.com/>

2. **Create a self-hosted Access application:**
   - Go to **Access → Applications → Add an application → Self-hosted**.
   - **Application name:** `PDF Reader` (or any name you like).
   - **Session duration:** 24 hours (or your preference).
   - **Application domain:** set to the **exact** Cloudflare Pages domain shown
     in your Pages project's **Deployments** tab. Cloudflare often appends a
     random suffix, so a project named `pdf-reader` may actually be served at
     e.g. `pdf-reader-3kl.pages.dev` — use that exact domain (including the
     suffix), not a guessed `pdf-reader.pages.dev`. Use a custom domain here
     instead if you have one. Leave the path empty to protect the entire site.
   - ⚠️ The Access application domain **must match the deployed site domain
     exactly**. If they differ, login succeeds but `/api/*` tokens are rejected.
     The same exact domain is also what you visit in the browser.

3. **Create an Access policy:**
   - **Policy name:** `Allow me`
   - **Action:** Allow
   - **Include rule:** Emails — enter your email address (e.g. `you@example.com`).
   - This ensures only your email can access the site. Add more emails or groups
     if needed.

4. **Obtain the Application Audience (AUD) tag and team domain:**
   - After creating the application, click on it in the list.
   - Copy the **Application Audience (AUD) Tag** — a long hex string.
   - Your **team domain** is found in the Zero Trust dashboard under
     **Settings** (Custom Pages / team domain), shaped like
     `https://<team>.cloudflareaccess.com`.
   - ⚠️ **Confirm the team domain before trusting it.** Do not guess the team
     name from your account or team display name — it can be different. Open
     `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` in a browser:
     the correct team domain returns JSON with a `keys` array. If you instead
     see an *"Unable to find your Access organization"* page, the team name is
     wrong — fix it before continuing.

5. **Update `wrangler.toml`:**

   ```toml
   [vars]
   TEAM_DOMAIN = "<team>.cloudflareaccess.com"
   ACCESS_AUD = "<your Application Audience Tag>"
   DEV_BYPASS = ""
   ```

   Both `TEAM_DOMAIN` and `ACCESS_AUD` are **non-secret** — they can safely live
   in `wrangler.toml` and be committed to the repo.

   > **Note — these vars are READ-ONLY in the dashboard.** Because `TEAM_DOMAIN`
   > and `ACCESS_AUD` are defined in `wrangler.toml` `[vars]`, the Cloudflare
   > Pages dashboard shows them as **read-only** (you cannot edit or delete them
   > under *Settings → Variables and secrets*). The only correct way to change
   > them is to edit `wrangler.toml` and **redeploy** — not via the dashboard.

   > **Note — changes require a REDEPLOY.** An already-built deployment keeps its
   > old vars. After changing `wrangler.toml` vars you must rebuild `web/` and
   > deploy again for the new values to take effect:
   >
   > ```sh
   > cd web && npm run build && cd ..
   > npx wrangler pages deploy web/dist --project-name pdf-reader
   > ```

---

## Cloudflare R2 + KV Setup

1. **Create the R2 bucket** (matches `bucket_name` in `wrangler.toml`):

   ```sh
   npx wrangler r2 bucket create pdf-reader-pdfs
   ```

2. **Create the KV namespace:**

   ```sh
   npx wrangler kv namespace create HL_KV
   ```

   This prints an `id`. Paste it into `wrangler.toml`, replacing the existing
   `id` under `[[kv_namespaces]]`.

---

## Deploy

### Option A: GitHub Actions — auto-deploy (recommended)

Pushing to `main` automatically builds and deploys. The workflow lives at
`.github/workflows/deploy.yml`.

**One-time setup:**

1. **Create a Cloudflare API token:** Dashboard → **My Profile → API Tokens →
   Create Token**. Use the **"Edit Cloudflare Workers"** template, or a custom
   token with the **Account → Cloudflare Pages → Edit** permission. Copy it
   (shown only once).
2. **Get your Account ID:** Dashboard → **Workers & Pages → Account details**
   (or the hex id in the dashboard URL).
3. **Add two repository secrets:** repo → **Settings → Secrets and variables →
   Actions → Secrets → New repository secret**:
   - `CLOUDFLARE_API_TOKEN` — the token from step 1.
   - `CLOUDFLARE_ACCOUNT_ID` — the account id from step 2.
4. **Push `.github/workflows/deploy.yml` and `wrangler.toml` to `main`.**

**What the workflow does on every push to `main`** (only when `web/`,
`functions/`, `worker/`, `wrangler.toml`, or the package/workflow files change):

1. Builds `web/` (`tsc` + Vite) — a type or build error **fails the run here**.
2. Typechecks the Pages Functions (`tsc --noEmit -p functions/tsconfig.json`).
3. Only if both pass → `wrangler pages deploy web/dist --project-name pdf-reader`.

So a broken build is caught by the gate and never deployed. Watch runs in the
repo's **Actions** tab. You can also trigger a run manually from there
(`workflow_dispatch`).

> **Important:** the deploy reads `TEAM_DOMAIN`, `ACCESS_AUD`, and the R2/KV
> bindings from the **committed** `wrangler.toml`. Make sure the real values
> (not the `YOUR_TEAM...` placeholders) are committed, or every auto-deploy
> ships broken auth (see Troubleshooting: "Invalid token"). These values are
> non-secret and safe to commit.

### Option B: Manual deploy

```sh
cd web && npm install && npm run build && cd ..
npx wrangler pages deploy web/dist --project-name=pdf-reader
```

The first deploy creates the Pages project.

---

## Local Development

Two processes running in parallel:

### 1. Build the SPA once (so `web/dist` exists)

```sh
cd web
npm install
npm run build
```

### 2. Start the Pages dev server (terminal 1)

From the project root:

```sh
npm install
npx wrangler pages dev web/dist --local
```

This starts Miniflare at `http://127.0.0.1:8788` with local R2/KV emulation.
The `.dev.vars` file (gitignored) sets `DEV_BYPASS=true`, so JWT verification
is bypassed and all requests use the fixed dev identity `dev@local`.

### 3. Start Vite dev server (terminal 2)

```sh
cd web
npm run dev
```

Vite serves at `http://localhost:5173` and proxies `/api/*` and `/cdn-cgi/*` to
`127.0.0.1:8788` (configured in `vite.config.ts`). Open `http://localhost:5173`
in your browser for hot-reload development.

### Dev bypass

The dev bypass is enabled by the gitignored `.dev.vars` file at the project root:

```
DEV_BYPASS=true
```

`wrangler pages dev` reads `.dev.vars` automatically. When `DEV_BYPASS=true`,
the auth module skips JWT verification and returns `{ email: 'dev@local',
identity: 'dev_at_local' }` for every request.

**Why it cannot fire in production:** `wrangler.toml` sets `DEV_BYPASS = ""`
(empty, off). The `.dev.vars` file is gitignored and never deployed. The only
way to enable the bypass in production would be a deliberate, visible change
to the Pages environment variables in the Cloudflare dashboard.

---

## Troubleshooting

### "Invalid token" / 403 on `/api/*` after a successful login

Login succeeds (you get through the Access screen) but every `/api/*` call
returns 403. This means `TEAM_DOMAIN` or `ACCESS_AUD` is wrong — or still a
placeholder — **in the deployed build**. Confirm the team domain with the
`/cdn-cgi/access/certs` check above, fix the values in `wrangler.toml`, then
**redeploy** (an already-built deployment keeps its old vars).

The API returns distinct error strings; each points at a different cause:

- **`Invalid token`** — bad or placeholder `TEAM_DOMAIN`, so the JWKS cert fetch
  fails, or a signature / `kid` mismatch.
- **`Invalid audience`** — `ACCESS_AUD` does not match the Access application's
  AUD tag.
- **`Invalid issuer`** — `TEAM_DOMAIN` mismatch even though the certs loaded.

Also double-check that the Access application domain matches the **exact**
deployed Pages domain (including any random suffix like `pdf-reader-3kl.pages.dev`).

### Uploaded PDF does not appear immediately

Cloudflare KV `list()` is **eventually consistent**, so a just-uploaded document
is often not yet visible to an immediate list refresh. The app handles this by
updating the library optimistically from the upload response, and a background
refresh reconciles with the server list after a short delay.

### First page still takes a moment on some large PDFs

If a PDF is not **linearized** (also called "Fast Web View" in Adobe Acrobat /
Optimize for web), PDF.js cannot locate page 1 until it has fetched and parsed
the cross-reference table, which may require a few extra range requests on a very
large file. This is a PDF format characteristic, not an app bug. To fix it,
re-save the PDF with linearization enabled (Acrobat: File → Save As Other →
Optimized PDF → check "Fast Web View"; or use `qpdf --linearize` on the
command line) before uploading.

---

## Copyright note

PDF files are **never committed to this repo**. They live only in your private
Cloudflare R2 bucket and are served solely to their owner through the handler.
The `.gitignore` excludes `**/*.pdf` so no PDF is accidentally tracked. Keep it
that way to avoid redistributing copyrighted material.
