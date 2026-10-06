// Content hashing for PDFs. The fileHash is the hex-encoded SHA-256 of the raw
// PDF bytes, computed in the browser. It is the stable key for a document across
// uploads/opens and the key for its highlights + progress.

/**
 * Computes the hex-encoded SHA-256 of the given bytes via crypto.subtle.
 * Returns a lowercase hex string.
 */
export async function computeFileHash(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(digest);
  let hex = '';
  for (const b of view) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}
