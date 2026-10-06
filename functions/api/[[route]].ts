// Catch-all Pages Function for /api/*. Delegates to the shared worker handler.
//
// esbuild (used by `wrangler pages dev`/`pages deploy`) follows the relative
// import below as an in-tree file across the package boundary; types resolve
// via functions/tsconfig.json which includes ../worker/src/**/*.ts.

import { handleRequest } from '../../worker/src/handler';
import type { Env } from '../../worker/src/env';

export const onRequest: PagesFunction<Env> = async (context) => {
  return handleRequest(context.request, context.env as Env);
};
