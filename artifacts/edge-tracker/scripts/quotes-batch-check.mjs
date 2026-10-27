#!/usr/bin/env node
/**
 * Quote library — batch checker for authoring files (src/data/quotes/_batches/*.json) before they are merged into the
 * shipped layout by quotes-merge.mjs. The shipped library is validated again by src/lib/quotes/__tests__/dataset.test.ts.
 *
 *   node scripts/quotes-batch-check.mjs                 all batch files
 *   node scripts/quotes-batch-check.mjs il od           only files whose name starts with one of the prefixes
 *
 * Batch file shape: { authors: {key: {ru,en,uz,uk}}, works: {key: {ru,en,uz,uk}}, quotes: [Entry] }
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(HERE, "..", "src", "data", "quotes", "_batches");

export const LANGS = ["ru", "en", "uz", "uk"];
export const CATS = ["olympus", "philosophy", "discipline", "trading", "psychology"];
export const TAGS = [
  "patience", "risk", "discipline", "loss", "ego", "process", "courage", "preparation", "humility", "resilience",
  "focus", "fear", "greed", "wisdom", "time", "change", "character", "learning", "action", "fate", "moderation",
  "self-knowledge", "opportunity", "responsibility", "strategy", "control", "endurance", "truth", "habit",
  "simplicity", "adaptability", "excellence",
];
export const REL = ["verified", "attributed"];
export const ORIG_LANGS = ["grc", "la", "en", "fr", "de", "zh", "ja", "it", "es", "ru", "other"];
const MIN_CHARS = 8;
const MAX_CHARS = 320;
const MAX_WORDS_EN = { trading: 30, default: 60 };
const ID_RE = /^[a-z]{2,4}-\d{3,4}$/;
const KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CYR = /[Ѐ-ӿ]/;

export const norm = (s) => s.toLowerCase().replace(/[«»"“”„'’ʻʼ`.,!?;:()\-—–…\s]+/g, " ").trim();
const words = (s) => s.trim().split(/\s+/).length;

export function checkEntries(files) {
  const errors = [];
  const ids = new Map();
  const texts = LANGS.map(() => new Map());
  const authors = {};
  const works = {};
  for (const { name, data } of files) {
    for (const [k, v] of Object.entries(data.authors ?? {})) {
      if (!KEY_RE.test(k)) errors.push(`${name}: bad author key "${k}"`);
      for (const l of LANGS) if (!v?.[l]?.trim()) errors.push(`${name}: author "${k}" missing ${l}`);
      authors[k] ??= v;
    }
    for (const [k, v] of Object.entries(data.works ?? {})) {
      if (!KEY_RE.test(k)) errors.push(`${name}: bad work key "${k}"`);
      for (const l of LANGS) if (!v?.[l]?.trim()) errors.push(`${name}: work "${k}" missing ${l}`);
      works[k] ??= v;
    }
  }
  for (const { name, data } of files) {
    if (!Array.isArray(data.quotes)) { errors.push(`${name}: "quotes" must be an array`); continue; }
    for (const q of data.quotes) {
      const at = `${name}:${q.id ?? "?"}`;
      if (!ID_RE.test(q.id ?? "")) errors.push(`${at}: bad id`);
      if (ids.has(q.id)) errors.push(`${at}: duplicate id (also in ${ids.get(q.id)})`);
      ids.set(q.id, name);
      if (!CATS.includes(q.cat)) errors.push(`${at}: bad cat "${q.cat}"`);
      if (!Array.isArray(q.tags) || q.tags.length < 1 || q.tags.length > 4) errors.push(`${at}: 1-4 tags required`);
      for (const t of q.tags ?? []) if (!TAGS.includes(t)) errors.push(`${at}: unknown tag "${t}"`);
      if (!q.author || !authors[q.author]) errors.push(`${at}: author "${q.author}" not defined in any batch "authors"`);
      if (!q.work || !works[q.work]) errors.push(`${at}: work "${q.work}" not defined in any batch "works"`);
      if (typeof q.loc !== "string") errors.push(`${at}: loc must be a string ("" only when the work has no internal numbering)`);
      if (!REL.includes(q.rel)) errors.push(`${at}: rel must be verified|attributed`);
      if (q.lang !== undefined && !ORIG_LANGS.includes(q.lang)) errors.push(`${at}: bad lang "${q.lang}"`);
      if (q.orig !== undefined && (typeof q.orig !== "string" || !q.orig.trim() || q.orig.length > 400)) errors.push(`${at}: bad orig`);
      LANGS.forEach((l, i) => {
        const s = q[l];
        if (typeof s !== "string" || s.trim().length < MIN_CHARS) { errors.push(`${at}: ${l} text missing/too short`); return; }
        if (s.length > MAX_CHARS) errors.push(`${at}: ${l} text over ${MAX_CHARS} chars (${s.length})`);
        if ((l === "ru" || l === "uk") && !CYR.test(s)) errors.push(`${at}: ${l} text has no Cyrillic`);
        if ((l === "en" || l === "uz") && CYR.test(s)) errors.push(`${at}: ${l} text contains Cyrillic`);
        const n = norm(s);
        if (texts[i].has(n)) errors.push(`${at}: duplicate ${l} text (same as ${texts[i].get(n)})`);
        texts[i].set(n, q.id);
      });
      const maxW = MAX_WORDS_EN[q.cat] ?? MAX_WORDS_EN.default;
      if (typeof q.en === "string" && words(q.en) > maxW) errors.push(`${at}: en text over ${maxW} words`);
    }
  }
  return { errors, count: ids.size, authors, works };
}

function main() {
  const prefixes = process.argv.slice(2);
  if (!fs.existsSync(DIR)) { console.log("no _batches directory"); return; }
  const all = fs.readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
  const files = [];
  for (const f of all) {
    try {
      files.push({ name: f, data: JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")) });
    } catch (e) {
      console.error(`${f}: invalid JSON — ${e.message}`);
      process.exitCode = 1;
    }
  }
  // Cross-batch duplicates and author/work keys are checked against every file; errors are reported for the selection.
  const { errors, count } = checkEntries(files);
  const mine = prefixes.length ? errors.filter((e) => prefixes.some((p) => e.startsWith(p))) : errors;
  const selected = prefixes.length ? files.filter((f) => prefixes.some((p) => f.name.startsWith(p))) : files;
  const n = selected.reduce((s, f) => s + (f.data.quotes?.length ?? 0), 0);
  for (const e of mine) console.error(e);
  console.log(`${selected.length} file(s), ${n} entries (library total ${count}); ${mine.length} error(s)`);
  if (mine.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
