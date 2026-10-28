/**
 * The curated quote library (lib/quotes): the web app asks for the quotes it shows instead of bundling ~1,800 entries
 * in four languages.
 *
 *   POST /quotes/pick        the quote for a slot (dashboard: the NY trading date; lock screen: the interval slot) or,
 *                            with `next`, the following draw — from the reader's no-repeat cycle, which the browser
 *                            keeps and sends (`state`); the answer carries the new state to store. Pure: no DB.
 *   GET  /quotes/items       quotes by id in one language (history, favourites, a quote reopened in another language)
 *   GET  /quotes/orig/:id    the original-language text of one quote
 *   GET  /quotes/theme       ids on a theme tag in a stable per-seed order (profile)
 *
 * Any signed-in caller, guests included (lib/auth GUEST_ALLOWED_MUTATIONS lets the pure pick through); pick and items
 * also answer a screen-locked session (lib/security/screenLock), since the lock screen shows a quote. The library
 * only changes with a deploy, so GET answers are cached by the browser for a day.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { notFound, route } from "../lib/http";
import { quoteLibrary, quoteOf, quoteOrig, quotePool, themeQuoteIds } from "../lib/quotes/library";
import { SURFACE_WEIGHTS, nextQuote, parseRotation, quoteForSlot, seedFor } from "../lib/quotes/rotation";
import { QUOTE_CATS, QUOTE_LANGS, QUOTE_TAGS, type Quote } from "../lib/quotes/types";

const router: IRouter = Router();

const ID = /^[a-z]{2,4}-\d{3,4}$/;
const ITEMS_MAX = 400;
const DAY_CACHE = "private, max-age=86400";

const lang = z.enum(QUOTE_LANGS);

const pickBody = z.object({
  surface: z.enum(["dash", "lock"]),
  lang,
  slot: z.string().min(1).max(40).regex(/^[\w:.-]+$/),
  /** users.settings.quotes.seed; absent → the hash of `who`. */
  seed: z.number().int().min(0).max(0xffffffff).nullish(),
  /** The name the browser keys its state by (lib/quotes/rotation userKey). */
  who: z.string().max(120).nullish(),
  cats: z.array(z.enum(QUOTE_CATS)).max(QUOTE_CATS.length).nullish(),
  /** Context tags (after a red day, on a green streak): prefer unseen quotes carrying one of them. */
  tags: z.array(z.enum(QUOTE_TAGS)).max(QUOTE_TAGS.length).nullish(),
  /** «Next»: always a fresh draw, even when the slot already has its quote. */
  next: z.boolean().optional(),
  /** RotationState from the browser; anything malformed counts as an empty cycle. */
  state: z.unknown().optional(),
});

export type QuotePick = { id: string; changed: boolean; state: ReturnType<typeof parseRotation>; quote: Quote; total: number; version: number };

router.post("/quotes/pick", route({ body: pickBody }, ({ body, res }): QuotePick => {
  const lib = quoteLibrary(body.lang);
  const opt = {
    seed: seedFor(body.seed, body.who, body.surface),
    weights: SURFACE_WEIGHTS[body.surface],
    cats: body.cats?.length ? body.cats : null,
    preferTags: body.tags?.length ? body.tags : null,
  };
  const state = parseRotation(body.state);
  const drawn = body.next ? nextQuote(lib.quotes, state, opt, body.slot) : null;
  const r = drawn ? { ...drawn, changed: true } : body.next ? null : quoteForSlot(lib.quotes, state, opt, body.slot);
  const quote = r ? quoteOf(lib, r.id) : null;
  if (!r || !quote) throw notFound();
  res.setHeader("Cache-Control", "private, no-store");
  return { id: r.id, changed: r.changed, state: r.state, quote, total: lib.quotes.length, version: lib.version };
}));

const idList = z
  .string()
  .max(ITEMS_MAX * 12)
  .transform((s) => [...new Set(s.split(",").map((x) => x.trim()).filter((x) => ID.test(x)))].slice(0, ITEMS_MAX));

router.get("/quotes/items", route({ query: z.object({ lang, ids: idList }) }, ({ query, res }) => {
  const lib = quoteLibrary(query.lang);
  const quotes = query.ids.map((id) => quoteOf(lib, id)).filter((q): q is Quote => !!q);
  res.setHeader("Cache-Control", DAY_CACHE);
  return { quotes, total: lib.quotes.length, version: lib.version };
}));

router.get("/quotes/orig/:id", route({ params: z.object({ id: z.string().regex(ID) }) }, ({ params, res }) => {
  const text = quoteOrig(params.id);
  if (!text) throw notFound();
  res.setHeader("Cache-Control", DAY_CACHE);
  return { id: params.id, text };
}));

router.get("/quotes/theme", route({
  query: z.object({ tag: z.string().max(40), seed: z.string().max(120) }),
}, ({ query, res }) => {
  const pool = quotePool();
  res.setHeader("Cache-Control", DAY_CACHE);
  return { ids: themeQuoteIds(pool, query.tag, query.seed), total: pool.length };
}));

export default router;
