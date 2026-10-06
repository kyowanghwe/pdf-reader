import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Same-origin Cloudflare Pages hosting: `base` is always '/'. In local dev,
// Vite proxies /api and /cdn-cgi to the local `wrangler pages dev` server
// (127.0.0.1:8788) so the SPA and API share an origin.
export default defineConfig({
    base: '/',
    plugins: [react()],
    server: {
        proxy: {
            '/api': 'http://127.0.0.1:8788',
            '/cdn-cgi': 'http://127.0.0.1:8788',
        },
    },
});
