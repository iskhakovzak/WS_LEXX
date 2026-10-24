#!/usr/bin/env node
/**
 * Quote library — merge authoring batches into the shipped layout (src/data/quotes):
 *
 *   meta.json         { version, quotes: [{ id, cat, tags, author, work, loc, lang?, rel, o? }] } — always loaded
 *   text.<lang>.json  { authors: {key: name}, works: {key: title}, texts: {id: text} }        — one per ru/en/uz/uk,
 *                     a separate lazy chunk each (the reader downloads only their language)
 *   orig.json         { id: original-language text }                                           — on demand («Оригинал»)
 *
 * The data are JSON on purpose: the repo's i18n / size ratchets scan *.ts(x) only, so quote texts in four languages
 * never count as hard-coded UI strings (they are content, like the share-card art credits). Validation of the shipped
 * files: src/lib/quotes/__tests__/dataset.test.ts (vitest).
 *
 * Workflow for new quotes: write src/data/quotes/_batches/<prefix>-N.json (shape in quotes-batch-check.mjs), run
 *   node scripts/quotes-batch-check.mjs          (fix errors)
 *   node scripts/quotes-merge.mjs --clean        (folds batches into the shipped files and deletes them; bumps version)
 * A batch entry with an existing id replaces it. `--remove id1,id2` drops entries.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LANGS, checkEntries } from "./quotes-batch-check.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "..", "src", "data", "quotes");
const BATCHES = path.join(OUT, "_batches");
const META_FIELDS = ["id", "cat", "tags", "author", "work", "loc", "lang", "rel"];

const args = process.argv.slice(2);
const clean = args.includes("--clean");
const removeArg = args.includes("--remove") ? args[args.indexOf("--remove") + 1] ?? "" : "";
const remove = new Set(removeArg.split(",").map((s) => s.trim()).filter(Boolean));

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

/** The shipped files as one batch (so a re-merge keeps everything already there). */
function shippedAsBatch() {
  const metaFile = path.join(OUT, "meta.json");
  if (!fs.existsSync(metaFile)) return null;
  const meta = readJson(metaFile);
  const texts = Object.fromEntries(LANGS.map((l) => [l, readJson(path.join(OUT, `text.${l}.json`))]));
  const origFile = path.join(OUT, "orig.json");
  const orig = fs.existsSync(origFile) ? readJson(origFile) : {};
  const authors = {};
  const works = {};
  for (const k of Object.keys(texts.en.authors)) authors[k] = Object.fromEntries(LANGS.map((l) => [l, texts[l].authors[k]]));
  for (const k of Object.keys(texts.en.works)) works[k] = Object.fromEntries(LANGS.map((l) => [l, texts[l].works[k]]));
  const quotes = meta.quotes.map(({ o: _o, ...m }) => ({
    ...m,
    ...(orig[m.id] ? { orig: orig[m.id] } : {}),
    ...Object.fromEntries(LANGS.map((l) => [l, texts[l].texts[m.id]])),
  }));
  return { version: meta.version ?? 0, batch: { name: "shipped", data: { authors, works, quotes } } };
}

const shipped = shippedAsBatch();
const batchFiles = fs.existsSync(BATCHES) ? fs.readdirSync(BATCHES).filter((f) => f.endsWith(".json")).sort() : [];
const batches = batchFiles.map((f) => ({ name: f, data: readJson(path.join(BATCHES, f)) }));

// Later wins: batches replace shipped entries with the same id; author / work names from batches win too.
const byId = new Map();
const authors = {};
const works = {};
for (const b of [...(shipped ? [shipped.batch] : []), ...batches]) {
  Object.assign(authors, b.data.authors ?? {});
  Object.assign(works, b.data.works ?? {});
  for (const q of b.data.quotes ?? []) byId.set(q.id, q);
}
for (const id of remove) byId.delete(id);
const quotes = [...byId.values()];

// Only keep author / work keys that are used.
const usedA = new Set(quotes.map((q) => q.author));
const usedW = new Set(quotes.map((q) => q.work));
for (const k of Object.keys(authors)) if (!usedA.has(k)) delete authors[k];
for (const k of Object.keys(works)) if (!usedW.has(k)) delete works[k];

const { errors } = checkEntries([{ name: "merged", data: { authors, works, quotes } }]);
if (errors.length) {
  for (const e of errors) console.error(e);
  console.error(`${errors.length} error(s) — nothing written`);
  process.exit(1);
}

const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
/** One record per line: readable diffs without the size of pretty-printed JSON. */
const lines = (rows) => `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]`;
const dict = (o) => `{\n${Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(",\n")}\n}`;

const version = (shipped?.version ?? 0) + (batches.length || remove.size ? 1 : 0);
// `o: 1` = orig.json has the original (the card offers «Показать оригинал» only then).
const meta = quotes.map((q) => ({ ...Object.fromEntries(META_FIELDS.filter((f) => q[f] !== undefined).map((f) => [f, q[f]])), ...(q.orig ? { o: 1 } : {}) }));
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "meta.json"), `{"version":${version},"quotes":${lines(meta)}}\n`);
for (const l of LANGS) {
  const a = sortKeys(Object.fromEntries(Object.entries(authors).map(([k, v]) => [k, v[l]])));
  const w = sortKeys(Object.fromEntries(Object.entries(works).map(([k, v]) => [k, v[l]])));
  const t = Object.fromEntries(quotes.map((q) => [q.id, q[l]]));
  fs.writeFileSync(path.join(OUT, `text.${l}.json`), `{"authors":${dict(a)},\n"works":${dict(w)},\n"texts":${dict(t)}}\n`);
}
const orig = Object.fromEntries(quotes.filter((q) => q.orig).map((q) => [q.id, q.orig]));
fs.writeFileSync(path.join(OUT, "orig.json"), `${dict(orig)}\n`);

if (clean) {
  for (const f of batchFiles) fs.rmSync(path.join(BATCHES, f));
  if (fs.existsSync(BATCHES) && fs.readdirSync(BATCHES).length === 0) fs.rmdirSync(BATCHES);
}
const sizes = ["meta.json", ...LANGS.map((l) => `text.${l}.json`), "orig.json"].map((f) => `${f} ${Math.round(fs.statSync(path.join(OUT, f)).size / 1024)}K`);
console.log(`quotes v${version}: ${quotes.length} entries, ${Object.keys(authors).length} authors, ${Object.keys(works).length} works — ${sizes.join(", ")}`);
