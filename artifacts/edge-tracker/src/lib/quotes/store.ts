/**
 * Per-browser state of the quote rotation (localStorage, per signed-in name), readable while the screen is locked:
 *
 *   ws_quotes.rot.<surface>.<user>   RotationState (./rotation.ts) of the dashboard card / the lock screen
 *   ws_quotes.hist.<user>            the last HISTORY_MAX quotes shown (id, time, surface) — the card's «История»
 *   ws_quotes.ledger.<user>          finished-day results for context matching (./context.ts)
 *   ws_quotes.prefs.<user>           mirror of users.settings.quotes (seed, favourites, categories) so the lock screen
 *                                    and an offline card use them without a request
 *   ws_lexx_lock_quote               lock-screen quote interval, minutes (Settings → Безопасность; per browser like
 *                                    the auto-lock)
 *
 * Every read validates; blocked storage degrades to in-memory defaults.
 */
import { useSyncExternalStore } from "react";
import { QUOTE_CATS, QUOTE_LANGS, type QuoteCat, type QuoteLang } from "./types";
import { hashString, parseRotation, type RotationState, type Surface } from "./rotation";
import { parseLedger, type DayLedger } from "./context";
import { parseLockQuoteInterval, type LockQuoteInterval } from "./lock-timer";

const userKey = (user: string | null | undefined) => (user || "me").trim().toLowerCase();

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked or full */ }
}

// ─── Rotation ─────────────────────────────────────────────────────────────────
const rotKey = (surface: Surface, user: string | null | undefined) => `ws_quotes.rot.${surface}.${userKey(user)}`;
export const readRotation = (surface: Surface, user: string | null | undefined): RotationState =>
  parseRotation(readJson(rotKey(surface, user)));
export const writeRotation = (surface: Surface, user: string | null | undefined, s: RotationState) => writeJson(rotKey(surface, user), s);

// ─── History ──────────────────────────────────────────────────────────────────
export const HISTORY_MAX = 60;
export interface HistoryEntry { id: string; at: number; s: Surface }
const histKey = (user: string | null | undefined) => `ws_quotes.hist.${userKey(user)}`;

export function parseHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is HistoryEntry => !!e && typeof e.id === "string" && typeof e.at === "number" && (e.s === "dash" || e.s === "lock"))
    .slice(0, HISTORY_MAX);
}
export const readHistory = (user: string | null | undefined) => parseHistory(readJson(histKey(user)));
/** Newest first; the same id moves to the top instead of repeating. */
export function pushHistory(user: string | null | undefined, e: HistoryEntry): HistoryEntry[] {
  const next = [e, ...readHistory(user).filter((x) => x.id !== e.id)].slice(0, HISTORY_MAX);
  writeJson(histKey(user), next);
  return next;
}

// ─── Day ledger (context) ─────────────────────────────────────────────────────
const ledgerKey = (user: string | null | undefined) => `ws_quotes.ledger.${userKey(user)}`;
export const readLedger = (user: string | null | undefined): DayLedger => parseLedger(readJson(ledgerKey(user)));
export const writeLedger = (user: string | null | undefined, l: DayLedger) => writeJson(ledgerKey(user), l);

// ─── Preferences (mirror of users.settings.quotes) ────────────────────────────
export const FAVS_MAX = 300;
export interface QuotePrefs {
  /** Rotation seed; absent until the server copy has one (then the name's hash stands in). */
  seed?: number;
  favs: string[];
  /** Categories on in the dashboard card (empty = all). */
  cats: QuoteCat[];
}
export const EMPTY_PREFS: QuotePrefs = { favs: [], cats: [] };

export function parsePrefs(raw: unknown): QuotePrefs {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const seed = typeof o.seed === "number" && Number.isInteger(o.seed) && o.seed >= 0 ? o.seed : undefined;
  const favs = Array.isArray(o.favs) ? [...new Set(o.favs.filter((x): x is string => typeof x === "string" && x.length <= 16))].slice(0, FAVS_MAX) : [];
  const cats = Array.isArray(o.cats) ? QUOTE_CATS.filter((c) => (o.cats as unknown[]).includes(c)) : [];
  return { ...(seed !== undefined ? { seed } : {}), favs, cats };
}
const prefsKey = (user: string | null | undefined) => `ws_quotes.prefs.${userKey(user)}`;
export const readPrefs = (user: string | null | undefined) => parsePrefs(readJson(prefsKey(user)));
export const writePrefs = (user: string | null | undefined, p: QuotePrefs) => writeJson(prefsKey(user), p);

/** The reader's seed for a surface: the stored seed (or the name's hash) salted per surface. */
export function seedFor(prefs: QuotePrefs, user: string | null | undefined, surface: Surface): number {
  const base = prefs.seed ?? hashString(userKey(user));
  return hashString(`${base}:${surface}`);
}

// ─── Quote language (the card's picker; the lock screen follows it) ─────────────
export const QUOTE_LANG_KEY = "daily_quote_lang";

/** The reader's quote language: their pick in the card, else the interface language (uk only by explicit pick). */
export function readQuoteLang(uiLang: string): QuoteLang {
  try {
    const v = localStorage.getItem(QUOTE_LANG_KEY);
    if (v && (QUOTE_LANGS as readonly string[]).includes(v)) return v as QuoteLang;
  } catch { /* storage blocked */ }
  return uiLang === "en" || uiLang === "uz" ? uiLang : "ru";
}

// ─── Lock-screen quote interval (per browser) ─────────────────────────────────
const INTERVAL_KEY = "ws_lexx_lock_quote";
const INTERVAL_EVENT = "ws-lock-quote-interval";

export function readLockQuoteInterval(): LockQuoteInterval {
  try { return parseLockQuoteInterval(localStorage.getItem(INTERVAL_KEY)); } catch { return parseLockQuoteInterval(null); }
}
export function writeLockQuoteInterval(m: LockQuoteInterval): void {
  try { localStorage.setItem(INTERVAL_KEY, String(m)); } catch { /* storage blocked */ }
  window.dispatchEvent(new Event(INTERVAL_EVENT));
}
function subscribeInterval(fn: () => void): () => void {
  const onStorage = (e: StorageEvent) => { if (e.key === INTERVAL_KEY) fn(); };
  window.addEventListener(INTERVAL_EVENT, fn);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(INTERVAL_EVENT, fn); window.removeEventListener("storage", onStorage); };
}
export function useLockQuoteInterval(): LockQuoteInterval {
  return useSyncExternalStore(subscribeInterval, readLockQuoteInterval, () => parseLockQuoteInterval(null));
}
