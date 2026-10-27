/**
 * Data results of the command palette: trades (already searched by the server), ideas, playbook setups, feed,
 * research and events, ranked locally with the matched characters of each title. Called during render (labels follow
 * the UI language). Texts: shell `palette.*`, common `trading.*`.
 */
import { commonI18n } from "@/i18n/ns/common";
import { shellI18n } from "@/i18n/ns/shell";
import { personName } from "@/i18n";
import { fmtUsd } from "@/lib/format";
import type { BadgeTone } from "./parts";
import { rankItems, titleRanges, type Field, type Hit, type Range } from "./rank";

export type Section = "trades" | "ideas" | "playbook" | "feed" | "research" | "events";

export type ResultItem = {
  id: string;
  section: Section;
  title: string;
  /** Matched characters of the title. */
  ranges?: Range[];
  subtitle?: string;
  badge?: string;
  badgeTone?: BadgeTone;
  meta?: string;
  path: string;
  /** Fires the in-page `ws-search-navigate` event for pages already mounted. */
  highlight?: number;
  /** An office setup: opens its cheat sheet over the current page instead of navigating. */
  sheetId?: number;
  score: number;
};

export type Corpora = { trades: any[]; ideas: any[]; playbook: any[]; feeds: any[]; research: any[]; events: any[] };

const clip = (v: unknown, n = 80) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);
const long = (text: unknown): Field => ({ text: typeof text === "string" ? text : null, weight: 0.5, fuzzy: false });
const minor = (text: unknown): Field => ({ text: typeof text === "string" ? text : null, weight: 0.7 });
const t = (k: Parameters<typeof shellI18n.t>[0]) => shellI18n.t(k);

/** Badge of a trade: net P&L in the trading format, else the outcome. */
export function tradeBadge(tr: any): { badge?: string; badgeTone?: BadgeTone } {
  const pnl = typeof tr.pnl === "number" ? tr.pnl - (typeof tr.fees === "number" ? tr.fees : 0) : null;
  if (pnl != null && Number.isFinite(pnl) && pnl !== 0) return { badge: fmtUsd(pnl, { signed: true, decimals: 0 }), badgeTone: pnl > 0 ? "up" : "down" };
  if (tr.result === "win") return { badge: commonI18n.t("trading.win"), badgeTone: "up" };
  if (tr.result === "loss") return { badge: commonI18n.t("trading.loss"), badgeTone: "down" };
  if (tr.result) return { badge: commonI18n.t("trading.breakeven"), badgeTone: "neutral" };
  return {};
}

export function tradeResult(tr: any, notesOnly = false, h?: Pick<Hit<unknown>, "field" | "ranges" | "score">): ResultItem {
  return {
    id: `trade-${tr.id}`,
    section: "trades",
    title: tr.ticker ?? "—",
    ranges: h ? titleRanges(h) : undefined,
    subtitle: notesOnly ? clip(tr.notes) : [
      tr.setup,
      tr.side === "short" || tr.side === "Short" ? t("palette.side.short") : tr.side === "long" || tr.side === "Long" ? t("palette.side.long") : null,
      tr.horizon && tr.horizon !== "intraday" ? (tr.horizon === "swing" ? t("palette.horizon.swing") : t("palette.horizon.overnight")) : null,
      `#${tr.id}`,
    ].filter(Boolean).join(" · ") || undefined,
    ...tradeBadge(tr),
    meta: tr.date?.substring?.(0, 10),
    path: "/trades",
    highlight: tr.id,
    score: h?.score ?? 0,
  };
}

const IDEA_TONE: Record<string, BadgeTone> = { approved: "up", published: "warn", draft: "neutral", rejected: "down" };

/** Ranked hits; rows the server matched on fields we do not hold (full notes) follow with score 0. */
function rankWithRest<T>(rows: readonly T[], q: string, fields: (r: T) => Field[], limit: number, keepUnmatched: boolean): Hit<T>[] {
  const hits = rankItems(rows, q, fields);
  if (keepUnmatched && hits.length < limit) {
    const seen = new Set(hits.map((h) => h.item));
    for (const r of rows) if (!seen.has(r)) hits.push({ item: r, score: 0, field: -1, ranges: [] });
  }
  return hits.slice(0, limit);
}

export function buildResults(query: string, notesOnly: boolean, c: Corpora): ResultItem[] {
  const q = query.trim().replace(/^\$/, "");
  if (!q) return [];
  const out: ResultItem[] = [];
  const nt = notesOnly;

  for (const h of rankWithRest(c.trades, q, (r) => (nt ? [long(r.notes)] : [r.ticker, minor(r.setup), minor(personName(r.trader ?? "")), long(r.notes), long(r.tags)]), 5, true)) {
    out.push(tradeResult(h.item, nt, h));
  }
  for (const h of rankItems(c.ideas, q, (r) => (nt ? [long(r.notes), long(r.description)] : [r.ticker, minor(r.setup), minor(personName(r.trader ?? "")), long(r.tags), long(r.notes), long(r.description)]), 5)) {
    const i = h.item;
    out.push({
      id: `idea-${i.id}`, section: "ideas", title: i.ticker ?? "—", ranges: titleRanges(h),
      subtitle: nt ? clip(i.notes || i.description) : [i.setup, personName(i.trader)].filter(Boolean).join(" · ") || undefined,
      badge: shellI18n.tryT(`palette.ideaStatus.${i.status}`) ?? i.status, badgeTone: IDEA_TONE[i.status] ?? "neutral",
      meta: i.createdAt?.substring?.(0, 10), path: `/trade-ideas?idea=${i.id}`, score: h.score,
    });
  }
  for (const h of rankItems(c.playbook, q, (e) => (nt ? [long(e.notes), long(e.conditions), long(e.checklist)] : [e.name, minor(e.folder), minor(e.tags), long(e.conditions), long(e.notes), long(e.checklist)]), 5)) {
    const e = h.item;
    out.push({
      id: `playbook-${e.id}`, section: "playbook", title: e.name ?? t("palette.fallback.setup"), ranges: titleRanges(h),
      subtitle: nt ? clip(e.notes || e.conditions) : (e.parentId ? t("palette.setupVariation") : e.folder || clip(e.conditions, 60)),
      badge: e.confidenceLevel != null ? `${e.confidenceLevel}%` : undefined,
      badgeTone: e.confidenceLevel >= 85 ? "up" : e.confidenceLevel >= 70 ? "accent" : "warn",
      // Deep link: the page opens ?id= in the library view on its own (also from another page).
      path: `/playbook?id=${e.id}`,
      sheetId: e.space === "office" || (!e.space && !e.trader) ? e.id : undefined,
      score: h.score,
    });
  }
  for (const h of rankItems(c.feeds, q, (f) => (nt ? [null, long(f.notes), long(f.whatWorksNow), long(f.whatDoesntWork)] : [f.date?.substring?.(0, 10), f.marketTheme, minor(f.tags), minor(f.bestTickers), long(f.notes), long(f.whatWorksNow), long(f.whatDoesntWork)]), 4)) {
    const f = h.item;
    out.push({
      id: `feed-${f.id}`, section: "feed", title: f.date?.substring(0, 10) ?? t("palette.fallback.feedEntry"), ranges: titleRanges(h),
      subtitle: clip(nt ? f.notes || f.whatWorksNow : f.marketTheme || f.notes, 70), path: "/dailyfeed", highlight: f.id, score: h.score,
    });
  }
  for (const h of rankItems(c.research, q, (r) => (nt ? [null, long(r.description), long(r.context), long(r.whatWorked)] : [r.patternName, r.ticker, long(r.description), long(r.context), long(r.whatWorked)]), 3)) {
    const r = h.item;
    out.push({
      id: `research-${r.id}`, section: "research", title: r.patternName ?? t("palette.fallback.research"), ranges: titleRanges(h),
      subtitle: nt ? clip(r.description || r.context) : r.ticker || clip(r.description, 60),
      badge: r.confidenceLevel != null ? `${r.confidenceLevel}%` : undefined, badgeTone: r.confidenceLevel >= 70 ? "up" : "neutral",
      path: "/research", score: h.score,
    });
  }
  for (const h of rankItems(c.events, q, (e) => (nt ? [null, long(e.summary)] : [e.ticker, e.headline, long(e.summary)]), 3)) {
    const e = h.item;
    out.push({
      id: `event-${e.id}`, section: "events", title: e.ticker ?? t("palette.fallback.event"), ranges: titleRanges(h),
      subtitle: clip(nt ? e.summary : e.headline || e.summary), meta: e.date?.substring(0, 10), path: `/events?id=${e.id}`, score: h.score,
    });
  }
  return out;
}

/** Results grouped by section, in first-seen order. */
export function bySection(items: readonly ResultItem[]): Map<Section, ResultItem[]> {
  const map = new Map<Section, ResultItem[]>();
  for (const it of items) {
    const arr = map.get(it.section);
    if (arr) arr.push(it); else map.set(it.section, [it]);
  }
  return map;
}
