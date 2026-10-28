/**
 * The quote library over the API (api-server routes/quotes.ts) — the web bundle carries no quote data:
 *
 *   pickQuote      POST /api/quotes/pick   the slot's quote (or «next») from the reader's cycle, which this browser keeps
 *                                          (./store.ts) and sends; the answer brings the new cycle to store
 *   fetchQuotes    GET  /api/quotes/items  quotes by id in one language (history, favourites, a language switch)
 *   fetchQuoteOrig GET  /api/quotes/orig/:id
 *   fetchThemeIds  GET  /api/quotes/theme   ids on a theme tag, stable per seed (profile)
 *
 * Every quote received is kept in memory for the session; the ones a pick shows are also kept in localStorage
 * (ws_quotes.cache, the newest CACHE_MAX), so today's quote and the lock screen's current one show after a reload
 * without a request. GET answers are cached by the browser for a day (Cache-Control from the server).
 */
import { http } from "@/lib/api/http";
import type { Surface } from "./store";
import type { Quote, QuoteCat, QuoteLang, QuoteTag } from "./types";

const CACHE_KEY = "ws_quotes.cache";
const CACHE_MAX = 40;
const ITEMS_CHUNK = 400;

interface CacheFile { total?: number; items: Record<string, Quote> }

const keyOf = (lang: QuoteLang, id: string) => `${lang}:${id}`;
const mem = new Map<string, Quote>();
let persisted: CacheFile | null = null;

function readCache(): CacheFile {
  if (persisted) return persisted;
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as CacheFile | null;
    persisted = raw && typeof raw === "object" && raw.items && typeof raw.items === "object" ? raw : { items: {} };
  } catch {
    persisted = { items: {} };
  }
  return persisted;
}

function persist(lang: QuoteLang, q: Quote, total: number) {
  const file = readCache();
  const items = { ...file.items };
  delete items[keyOf(lang, q.id)];
  items[keyOf(lang, q.id)] = q;
  const keys = Object.keys(items);
  for (const k of keys.slice(0, Math.max(0, keys.length - CACHE_MAX))) delete items[k];
  persisted = { total, items };
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(persisted)); } catch { /* storage blocked or full */ }
}

/** A quote already received in this language (memory, then the persisted picks). */
export function cachedQuote(lang: QuoteLang, id: string | null | undefined): Quote | null {
  if (!id) return null;
  const k = keyOf(lang, id);
  const hit = mem.get(k) ?? readCache().items[k];
  if (hit && typeof hit.text === "string" && hit.id === id) {
    mem.set(k, hit);
    return hit;
  }
  return null;
}

/** The category of a quote received in any language (eligibility of a stored quote without a request). */
export function cachedCat(id: string): QuoteCat | null {
  for (const [k, q] of mem) if (k.endsWith(`:${id}`)) return q.cat;
  for (const [k, q] of Object.entries(readCache().items)) if (k.endsWith(`:${id}`)) return q.cat;
  return null;
}

/** Library size from the last answer (the card's counter). */
export const cachedTotal = (): number | null => readCache().total ?? null;

export interface PickRequest {
  surface: Surface;
  lang: QuoteLang;
  slot: string;
  seed?: number | null;
  who: string;
  cats?: readonly QuoteCat[] | null;
  tags?: readonly QuoteTag[] | null;
  next?: boolean;
  state: unknown;
}

export interface PickResult {
  id: string;
  changed: boolean;
  state: unknown;
  quote: Quote;
  total: number;
}

export async function pickQuote(req: PickRequest): Promise<PickResult> {
  const r = await http.post<PickResult>("/api/quotes/pick", req);
  mem.set(keyOf(req.lang, r.quote.id), r.quote);
  persist(req.lang, r.quote, r.total);
  return r;
}

/** Persist a quote like a pick (the card's quote on screen, e.g. after a language switch). */
export function keepQuote(lang: QuoteLang, q: Quote): void {
  if (readCache().items[keyOf(lang, q.id)]) return;
  persist(lang, q, readCache().total ?? 0);
}

/** The quotes of `ids` in `lang`, in that order (unknown ids are left out); only the missing ones are requested. */
export async function fetchQuotes(lang: QuoteLang, ids: readonly string[]): Promise<Quote[]> {
  const missing = [...new Set(ids.filter((id) => !cachedQuote(lang, id)))];
  for (let i = 0; i < missing.length; i += ITEMS_CHUNK) {
    const part = missing.slice(i, i + ITEMS_CHUNK);
    const r = await http.get<{ quotes: Quote[] }>("/api/quotes/items", { query: { lang, ids: part.join(",") } });
    for (const q of r.quotes) mem.set(keyOf(lang, q.id), q);
  }
  return ids.map((id) => cachedQuote(lang, id)).filter((q): q is Quote => !!q);
}

const origs = new Map<string, Promise<string>>();

/** The original-language text of a quote ("" when there is none). */
export function fetchQuoteOrig(id: string): Promise<string> {
  const hit = origs.get(id);
  if (hit) return hit;
  const p = http.get<{ text: string }>(`/api/quotes/orig/${encodeURIComponent(id)}`).then((r) => r.text ?? "");
  p.catch(() => origs.delete(id));
  origs.set(id, p);
  return p;
}

export async function fetchThemeIds(tag: string, seed: string): Promise<string[]> {
  const r = await http.get<{ ids: string[] }>("/api/quotes/theme", { query: { tag, seed } });
  return r.ids;
}
