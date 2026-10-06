// Shared environment bindings for the Pages Function + Worker handler.
//
// R2 + KV bindings are provided by wrangler.toml. The Access vars (TEAM_DOMAIN,
// ACCESS_AUD) are non-secret config. DEV_BYPASS is "true" only in local dev
// (via a gitignored .dev.vars file); it defaults to "" in production.

export interface Env {
  PDF_BUCKET: R2Bucket;
  HL_KV: KVNamespace;
  TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  DEV_BYPASS: string;
}
