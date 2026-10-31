#!/usr/bin/env node
/**
 * Build smoke test, run after `astro build` (package.json "build"). Fails the build when a page is missing, the
 * noindex flag is not honoured, analytics leak into a build without its env vars, the honesty wording of the
 * integrations changes, or Cyrillic text appears. Then lists the placeholders the owner still has to fill.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const failures = [];
const fail = (m) => failures.push(m);

const pages = ["index.html", "terms/index.html", "privacy/index.html", "refund/index.html",
  "es/index.html", "es/terms/index.html", "es/privacy/index.html", "es/refund/index.html"];
const read = (p) => readFileSync(path.join(dist, p), "utf8");

const noindex = process.env.LANDING_INDEXABLE !== "1";
const umami = !!(process.env.PUBLIC_UMAMI_URL && process.env.PUBLIC_UMAMI_ID);

for (const p of pages) {
  if (!existsSync(path.join(dist, p))) { fail(`missing page ${p}`); continue; }
  const html = read(p);
  const hasNoindex = /<meta name="robots" content="noindex"/.test(html);
  if (noindex !== hasNoindex) fail(`${p}: noindex meta ${hasNoindex ? "present" : "missing"} (LANDING_INDEXABLE=${process.env.LANDING_INDEXABLE ?? ""})`);
  if (!umami && /data-website-id/.test(html)) fail(`${p}: Umami script without PUBLIC_UMAMI_URL / PUBLIC_UMAMI_ID`);
  if (umami && !/data-website-id/.test(html)) fail(`${p}: Umami env vars set but no script tag`);
  if (/\p{Script=Cyrillic}/u.test(html)) fail(`${p}: Cyrillic text in the landing`);
  if (!/<h1[\s>]/.test(html)) fail(`${p}: no h1`);
}

if (existsSync(path.join(dist, "index.html"))) {
  const en = read("index.html");
  for (const needle of ["The operating system for prop desks", "Book a demo", "Get access", "PropReports", "Live sync out of the box",
    "Connected for you on request, typically within days", "data-lead-form", 'lang="en"']) {
    if (!en.includes(needle)) fail(`index.html: expected "${needle}"`);
  }
  if (/\$\s?\d+\s?\/\s?(mo|month)|free trial/i.test(en)) fail("index.html: prices or a free trial mentioned");
}
if (existsSync(path.join(dist, "es/index.html")) && !read("es/index.html").includes('lang="es"')) fail('es/index.html: expected lang="es"');

const robots = existsSync(path.join(dist, "robots.txt")) ? readFileSync(path.join(dist, "robots.txt"), "utf8") : "";
if (noindex && !/Disallow: \//.test(robots)) fail("robots.txt must disallow everything while noindex is on");

function size(dir) {
  let total = 0;
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    const s = statSync(p);
    total += s.isDirectory() ? size(p) : s.size;
  }
  return total;
}

if (failures.length) {
  console.error(`landing smoke: ${failures.length} problem(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

const config = readFileSync(path.join(root, "src", "site.config.ts"), "utf8");
const open = [...new Set(config.match(/\{\{[A-Z_]+\}\}/g) ?? [])];
const shotNames = [...config.matchAll(/name: "([a-z-]+)", hero:/g)].map((x) => x[1]);
const shots = shotNames.filter((n) => ![`${n}.webp`, `${n}-800.webp`].every((f) => existsSync(path.join(root, "public", "screens", f))));
console.log(`landing smoke: ${pages.length} pages ok, noindex=${noindex}, umami=${umami}, dist ${(size(dist) / 1024).toFixed(0)} KB`);
if (open.length) console.log(`  placeholders still to fill in src/site.config.ts: ${open.join(" ")}`);
if (shots.length) console.log(`  screenshots not added yet (public/screens/*.webp): ${shots.join(", ")}`);
