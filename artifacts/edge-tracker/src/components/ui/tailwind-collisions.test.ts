/**
 * Tailwind name collisions with the rhythm tokens. Tailwind 4.2 has logical sizing utilities (`inline-<n>` =
 * inline-size, `block-<n>` = block-size) and resolves `<n>` from the spacing scale, where index.css defines
 * `--spacing-grid`. So the class `inline-grid` emits BOTH `display: inline-grid` and `inline-size: var(--grid-gap)`:
 * the element is squeezed to 12–16 px and its text spills over the neighbours (the risk sheet's «$300» drawn over
 * the «100% left» label). Use the arbitrary property `[display:inline-grid]` instead.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "../..");
const TOKENS = ["section", "grid", "panel", "head", "stack", "inline", "field", "tile"];
// Static utilities whose names look like `inline-<token>` / `block-<token>`; only `inline-grid` exists today.
const BANNED = TOKENS.flatMap((tk) => [`inline-${tk}`, `block-${tk}`]).filter((c) => c !== "inline-inline");

function files(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, out);
    else if (/\.(tsx|ts|css)$/.test(e.name) && !e.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("tailwind class collisions with the spacing tokens", () => {
  it("never uses a class that also resolves to a logical size from the rhythm tokens", () => {
    const re = new RegExp(`(?<![\\w:[-])(?:[a-z0-9-]+:)*(${BANNED.join("|")})(?![\\w-])`, "g");
    const hits: string[] = [];
    for (const f of files(SRC)) {
      const lines = fs.readFileSync(f, "utf8").split("\n");
      lines.forEach((l, i) => {
        if (/^\s*(\*|\/\/|\/\*)/.test(l)) return;
        for (const m of l.matchAll(re)) hits.push(`${path.relative(SRC, f)}:${i + 1} ${m[0]}`);
      });
    }
    expect(hits).toEqual([]);
  }, 20_000);
});
