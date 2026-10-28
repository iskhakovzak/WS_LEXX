/**
 * Cache-Control for the built site (dist/public), served by express.static in production.
 *
 * express.static sent `max-age=0` for everything, so every visit revalidated every script, style and font. Files
 * under `assets/` carry a content hash in their name (Vite build): a new build means a new URL, so they are cached
 * for a year as immutable. The HTML shell and the manifest must pick up a deploy at once: `no-cache` (always
 * revalidated, ETag → 304). Everything else in public/ (backgrounds, share art, icons) keeps a stable name, so it
 * gets a day: a replaced picture reaches everyone by the next day, and the icons are busted with `?v=` anyway.
 */
import path from "node:path";

export const IMMUTABLE = "public, max-age=31536000, immutable";
export const REVALIDATE = "no-cache";
export const ONE_DAY = "public, max-age=86400";

/** Policy for a file at `relPath` (relative to the static root; either slash). */
export function staticCacheControl(relPath: string): string {
  const p = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (p.startsWith("assets/")) return IMMUTABLE;
  if (/\.(html|webmanifest)$/i.test(p)) return REVALIDATE;
  return ONE_DAY;
}

/** `setHeaders` for express.static rooted at `root`. */
export function staticCacheHeaders(root: string) {
  return (res: { setHeader(name: string, value: string): unknown }, filePath: string): void => {
    res.setHeader("Cache-Control", staticCacheControl(path.relative(root, filePath)));
  };
}
