// «Спроси журнал» — loading and execution.
// The whole accessible trade book is loaded once (GET /api/trades/page, cursor paging, limit 500, ≤ 10 pages) and
// cached by react-query under ASK_BOOK_KEY; every question then runs synchronously on the client. GET only.

import { apiUrl } from "@/lib/api";
import { links } from "@/lib/links";
import {
  applyFilter, buildAnswer, buildCompare, indexBook, MAX_LINK_IDS,
  type AskAnswer, type AskLinkParams, type AskTrade, type BookIndex,
} from "./aggregate";
import { filterOf, type AskFilter, type AskQuery } from "./parse";

export const ASK_PAGE_LIMIT = 500;
export const ASK_MAX_PAGES = 10;
/** Starts with "/api/trades" ⇒ invalidated together with every trade-dependent query. */
export const ASK_BOOK_KEY = ["/api/trades/ask-book"] as const;

type PageResponse = { items?: AskTrade[]; page?: { hasMore?: boolean; nextCursor?: string | null } };

export interface AskBook {
  trades: AskTrade[];
  truncated: boolean;
  index: BookIndex;
  /** Tickers by trade count (desc). */
  tickers: Array<{ value: string; n: number }>;
  setups: Array<{ value: string; n: number }>;
  traders: Array<{ value: string; n: number }>;
  firstDate: string | null;
  lastDate: string | null;
}

function countBy(values: Array<string | null | undefined>): Array<{ value: string; n: number }> {
  const m = new Map<string, { value: string; n: number }>();
  for (const v of values) {
    const s = (v ?? "").trim();
    if (!s) continue;
    const k = s.toLowerCase();
    const e = m.get(k) ?? { value: s, n: 0 };
    e.n++;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.n - a.n || a.value.localeCompare(b.value));
}

export function makeBook(trades: AskTrade[], truncated = false): AskBook {
  const dates = trades.map((t) => t.date).filter(Boolean).sort();
  return {
    trades,
    truncated,
    index: indexBook(trades),
    tickers: countBy(trades.map((t) => (t.ticker ?? "").toUpperCase())),
    setups: countBy(trades.map((t) => t.setup)),
    traders: countBy(trades.map((t) => t.trader)),
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
  };
}

/** Every trade the session can read (a curator sees the desk; a trader — own trades). */
export async function fetchAskBook(signal?: AbortSignal): Promise<AskBook> {
  const out: AskTrade[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < ASK_MAX_PAGES; page++) {
    const p = new URLSearchParams({ sort: "date", dir: "desc", limit: String(ASK_PAGE_LIMIT) });
    if (cursor) p.set("cursor", cursor);
    const r = await fetch(apiUrl(`/api/trades/page?${p.toString()}`), { signal });
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { const j = await r.json(); if (j?.error) msg = String(j.error); } catch { /* not JSON */ }
      throw new Error(msg);
    }
    const j = (await r.json()) as PageResponse;
    out.push(...(j.items ?? []));
    if (!j.page?.hasMore || !j.page.nextCursor) return makeBook(out, false);
    cursor = j.page.nextCursor;
  }
  return makeBook(out, true);
}

/** href into /trades with the parameters the trades page reads. */
export function tradesHref(l: AskLinkParams): string {
  return links.trades({
    ticker: l.ticker, setup: l.setup, date: l.date, from: l.date ? undefined : l.from, to: l.date ? undefined : l.to,
    ids: l.ids, side: l.side, outcome: l.outcome, trader: l.trader,
  });
}

export interface AskRunOptions {
  /** Signed-in trader name: the default scope unless the question names a trader or the whole desk. */
  me?: string | null;
}

export interface AskRun {
  answer: AskAnswer;
  href: string;
  /** The effective filter (with the default trader applied). */
  filter: AskFilter;
  /** Trader the answer was scoped to by default (not named in the question). */
  defaultTrader: string | null;
}

/** Runs a parsed question over the loaded book (synchronous, pure). */
export function runAsk(q: AskQuery, book: AskBook, opts: AskRunOptions = {}): AskRun {
  const base = filterOf(q);
  const traderNamed = Boolean(q.trader) || q.compare?.dim === "trader";
  const scopeDesk = q.allTraders || q.groupBy === "trader" || q.target === "trader";
  const known = new Set(book.traders.map((t) => t.value));
  const defaultTrader = !traderNamed && !scopeDesk && opts.me && known.has(opts.me) ? opts.me : null;
  const f: AskFilter = { ...base, trader: base.trader ?? defaultTrader };
  const scope = f.trader ? book.trades.filter((t) => t.trader === f.trader) : book.trades;
  const meta = { truncated: book.truncated, maxLinkIds: MAX_LINK_IDS, total: scope.length };

  if (q.intent === "compare" && q.compare) {
    const fa: AskFilter = { ...f, ...q.compare.a.patch };
    const fb: AskFilter = { ...f, ...q.compare.b.patch };
    const ra = applyFilter(book.trades, fa, book.index);
    const rb = applyFilter(book.trades, fb, book.index);
    const notes: string[] = [];
    const noTime = ra.noTime + rb.noTime;
    if (noTime) notes.push(`${noTime} сделок без времени входа не учтены.`);
    const answer = buildCompare(q, f, ra.kept, rb.kept, book.index, { ...meta, notes });
    return { answer, href: tradesHref(answer.link), filter: f, defaultTrader };
  }

  const r = applyFilter(book.trades, f, book.index);
  const answer = buildAnswer(q, f, r.kept, book.index, { ...meta, noTime: r.noTime, noHold: r.noHold, noPrice: r.noPrice, noQty: r.noQty });
  return { answer, href: tradesHref(answer.link), filter: f, defaultTrader };
}
