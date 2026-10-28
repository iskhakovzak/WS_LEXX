import { describe, expect, it } from "vitest";
import path from "node:path";
import { IMMUTABLE, ONE_DAY, REVALIDATE, staticCacheControl, staticCacheHeaders } from "../staticCache";

describe("static cache policy", () => {
  it("hashed build assets are immutable, the shell revalidates, the rest keeps a day", () => {
    expect(staticCacheControl("assets/index-CjqBOA40.js")).toBe(IMMUTABLE);
    expect(staticCacheControl("assets\\inter-latin-wght-normal-Ab12.woff2")).toBe(IMMUTABLE);
    expect(staticCacheControl("index.html")).toBe(REVALIDATE);
    expect(staticCacheControl("manifest.webmanifest")).toBe(REVALIDATE);
    expect(staticCacheControl("backgrounds/porsche-gt3rs-1920.webp")).toBe(ONE_DAY);
    expect(staticCacheControl("robots.txt")).toBe(ONE_DAY);
  });

  it("setHeaders resolves the path against the static root", () => {
    const root = path.resolve("/srv/public");
    const set: Record<string, string> = {};
    staticCacheHeaders(root)({ setHeader: (k, v) => (set[k] = v) }, path.join(root, "assets", "a-1.css"));
    expect(set["Cache-Control"]).toBe(IMMUTABLE);
  });
});
