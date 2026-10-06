import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// `base` must match the GitHub Pages path the app is served from.
// For a project page at https://<user>.github.io/<repo>/ set VITE_BASE=/<repo>/.
// For a user/org page or custom domain, leave it as '/'.
// VITE_WORKER_URL is read by the frontend (src/api.ts) as the Worker API base URL.
export default defineConfig({
    base: process.env.VITE_BASE || '/',
    plugins: [react()],
});
