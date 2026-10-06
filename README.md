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

---

## Cloudflare Zero Trust / Access Setup

Before deploying, configure Cloudflare Access to protect the Pages site:

1. **Log in to the Cloudflare Zero Trust dashboard:** <https://one.dash.cloudflare.com/>

2. **Create a self-hosted Access application:**
   - Go to **Access → Applications → Add an application → Self-hosted**.
   - **Application name:** `PDF Reader` (or any name you like).
   - **Session duration:** 24 hours (or your preference).
   - **Application domain:** set to your Cloudflare Pages domain, e.g.
     `pdf-reader.pages.dev` (or your custom domain if you have one).
     Leave the path empty to protect the entire site.

3. **Create an Access policy:**
   - **Policy name:** `Allow me`
   - **Action:** Allow
   - **Include rule:** Emails — enter your email address (e.g. `you@example.com`).
   - This ensures only your email can access the site. Add more emails or groups
     if needed.

4. **Obtain the Application Audience (AUD) tag and team domain:**
   - After creating the application, click on it in the list.
   - Copy the **Application Audience (AUD) Tag** — a long hex string.
   - Your **team domain** is shown in the URL: `https://<team>.cloudflareaccess.com`.

5. **Update `wrangler.toml`:**

   ```toml
   [vars]
   TEAM_DOMAIN = "<team>.cloudflareaccess.com"
   ACCESS_AUD = "<your Application Audience Tag>"
   DEV_BYPASS = ""
   ```

   Both `TEAM_DOMAIN` and `ACCESS_AUD` are **non-secret** — they can safely live
   in `wrangler.toml` and be committed to the repo.

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

### Option A: GitHub Actions (recommended)

1. Push this repo to GitHub.
2. In your repo **Settings → Secrets and variables → Actions → Secrets**, add:
   - `CLOUDFLARE_API_TOKEN` — a Cloudflare API token with Pages + R2 + KV permissions.
   - `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account ID.
3. Push to `main`. The workflow builds `web/` and runs `wrangler pages deploy`.

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

## Copyright note

PDF files are **never committed to this repo**. They live only in your private
Cloudflare R2 bucket and are served solely to their owner through the handler.
The `.gitignore` excludes `**/*.pdf` so no PDF is accidentally tracked. Keep it
that way to avoid redistributing copyrighted material.
