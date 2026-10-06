const STORAGE_KEY = 'pdf-reader-user-id';

/**
 * Returns the per-browser userId, creating and persisting one on first use.
 * Sent as the X-User-Id header on every Worker request.
 */
export function getUserId(): string {
  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}
