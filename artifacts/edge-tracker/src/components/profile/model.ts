/**
 * Pure helpers of the profile views: every sentence built from server codes (summary, attribute explanations,
 * biography events), the year heat grid, radar geometry and the style rows. Unit-tested (model.test.ts).
 */
import { fmtDate, fmtMonth, fmtNum, fmtRate, fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { coachI18n } from "@/i18n/ns/coach";
import { questsI18n } from "@/i18n/ns/quests";
import { profileI18n } from "@/i18n/ns/profile";
import type { EmblemKey, Metal } from "@/components/shared/medals";
import {
  ATTR_KEYS, HOLD_BUCKETS, PRICE_BUCKETS,
  type AttrKey, type Attribute, type Era, type ProfileSummary, type Style, type TimelineEvent,
} from "./api";

const t = profileI18n.t;

export const attrName = (k: AttrKey): string => t(`attr.${k}.name`);
export const attrLower = (k: AttrKey): string => t(`attr.${k}.lower`);
export const attrWhat = (k: AttrKey): string => t(`attr.${k}.what`);

/** «Интрадей-трейдер. Сильные стороны — дисциплина и edge, зона роста — исполнение.» (+ the low-data note). */
export function summaryText(s: ProfileSummary): string {
  const archetype = t(`archetype.${s.archetype}`);
  const [a, b] = s.top;
  const weak = s.weak ? attrLower(s.weak) : null;
  let line: string;
  if (a && b) line = weak ? t("summary.twoAndWeak", { archetype, top1: attrLower(a), top2: attrLower(b), weak }) : t("summary.two", { archetype, top1: attrLower(a), top2: attrLower(b) });
  else if (a) line = weak ? t("summary.oneAndWeak", { archetype, top1: attrLower(a), weak }) : t("summary.one", { archetype, top1: attrLower(a) });
  else line = weak ? t("summary.weak", { archetype, weak }) : t("summary.none", { archetype });
  return s.lowData ? `${line} ${t("summary.lowData")}` : line;
}

/** The number shown for an attribute: never a precise score on a low sample. */
export function attrValueText(a: Pick<Attribute, "score" | "low">): string {
  return a.low || a.score === null ? t("card.lowData") : String(a.score);
}

/** «42 из 60 дн.» — how much data the score stands on. */
export function sampleText(a: Pick<Attribute, "sample" | "minSample" | "unit">): string {
  return t("card.sample", { sample: a.sample, min: a.minSample, unit: t(`card.unit.${a.unit}`) });
}

const usd = (v: number | null | undefined, signed = true) => fmtUsd(v ?? null, { signed });
const rate = (v: number | null | undefined) => fmtRate(v ?? null);
const n2 = (v: number | null | undefined) => fmtNum(v ?? null);

/** One sentence: the numbers behind the score. */
export function attrExplain(a: Attribute): string {
  const i = a.inputs;
  switch (a.basis) {
    case "violations": return t("explain.violations", { violations: i.violations ?? 0, days: a.sample, perDay: n2(i.perDay) });
    case "noRules": return t("explain.noRules");
    case "limits": return t("explain.limits", { worst: usd(i.worstDay), dd: usd(i.maxDrawdown, false), limit: usd(i.dailyLimit, false), ddLimit: usd(i.ddLimit, false), breaches: i.breaches ?? 0 });
    case "tail": return t("explain.tail", { worst: usd(i.worstDay), dd: usd(i.maxDrawdown, false) });
    case "days": return t("explain.days", { green: rate(i.greenShare), sd: usd(i.sd, false), meanAbs: usd(i.meanAbs, false) });
    case "bootstrap": return t("explain.bootstrap", { exp: usd(i.expectancy), lo: usd(i.lo80), hi: usd(i.hi80) });
    case "shrunk": return t("explain.shrunk", { exp: usd(i.expectancy), lo: usd(i.lo80), hi: usd(i.hi80), theta: usd(i.shrunk) });
    case "frequency":
      return i.deskTradesPerDay == null
        ? t("explain.frequencyNoDesk", { tpd: n2(i.tradesPerDay), over: rate(i.overtradeShare) })
        : t("explain.frequency", { tpd: n2(i.tradesPerDay), desk: n2(i.deskTradesPerDay), over: rate(i.overtradeShare) });
    case "giveback": return t("explain.giveback", { gb: rate(i.givebackShare), peak: usd(i.avgPeak, false) });
    case "afterLoss": return t("explain.afterLoss", { after: rate(i.winRateAfterLoss), all: rate(i.winRate), afterRed: usd(i.afterRedDay), avg: usd(i.avgDay) });
    case "trend": return t("explain.trend", { prev: usd(i.prevAvg), recent: usd(i.recentAvg), p: rate(i.pImprove) });
  }
}

const stageName = (s: unknown): string => (typeof s === "string" ? commonI18n.tryT(`tiers.${s}`) ?? s : "");
const monthName = (ym: unknown): string => {
  if (typeof ym !== "string" || !/^\d{4}-\d{2}$/.test(ym)) return String(ym ?? "");
  return fmtDate(`${ym}-15`, "monthYear");
};

/** The biography line of one event. */
export function eventText(e: TimelineEvent): string {
  const p = e.params;
  const num = (k: string) => (typeof p[k] === "number" ? (p[k] as number) : 0);
  switch (e.kind) {
    case "joined": return t("bio.event.joined");
    case "first_trade": return t("bio.event.first_trade", { ticker: String(p.ticker ?? "") });
    case "milestone_trades": return t("bio.event.milestone_trades", { count: num("count") });
    case "stage_change":
      return p.from && p.from !== p.to
        ? t("bio.event.stage_changeFrom", { from: stageName(p.from), to: stageName(p.to) })
        : t("bio.event.stage_change", { to: stageName(p.to) });
    case "readiness": return t("bio.event.readiness", { stage: stageName(p.stage) });
    case "achievement": return t("bio.event.achievement", { name: achievementName(String(p.line ?? "")), tier: tierName(String(p.tier ?? "")) });
    case "best_day": return t("bio.event.best_day", { net: usd(num("net")), trades: commonI18n.t("units.trades", { count: num("trades") }) });
    case "best_week": return t("bio.event.best_week", { net: usd(num("net")) });
    case "best_month": return t("bio.event.best_month", { month: monthName(p.month), net: usd(num("net")) });
    case "first_green_month": return t("bio.event.first_green_month", { month: monthName(p.month), net: usd(num("net")) });
    case "drawdown": return t("bio.event.drawdown", { depth: usd(num("depth"), false), from: fmtDate(String(p.from ?? ""), "dayMonth") });
    case "recovery": return t("bio.event.recovery", { depth: usd(num("depth"), false) });
    case "rule_adopted": return p.origin === "desk" ? t("bio.event.rule_adoptedDesk") : t("bio.event.rule_adopted");
    case "intervention":
      return t("bio.event.intervention", {
        kind: coachI18n.tryT(`interventions.kind.${String(p.kind)}`) ?? String(p.kind ?? ""),
        trigger: coachI18n.tryT(`interventions.trigger.${String(p.trigger)}`) ?? String(p.trigger ?? ""),
      });
  }
}

/** Events a viewer sees highlighted as staff-only (curator steps). */
export const isStaffOnlyEvent = (e: TimelineEvent): boolean => e.kind === "intervention";

/** Kinds of events that mark a peak of the story (drawn as filled markers). */
export const isHighlightEvent = (e: TimelineEvent): boolean =>
  e.kind === "best_day" || e.kind === "best_week" || e.kind === "best_month" || e.kind === "stage_change" || e.kind === "first_green_month" || e.kind === "recovery";

export const achievementName = (line: string): string => questsI18n.tryT(`ach.${line}.title`) ?? line;
export const tierName = (tier: string): string => questsI18n.tryT(`achievements.tier.${tier}`) ?? tier;

/** One Greek emblem per achievement category (same as the quests medals). */
export const CATEGORY_EMBLEM: Readonly<Record<string, EmblemKey>> = {
  discipline: "shield", review: "scroll", focus: "bow", risk: "scales", planning: "temple", learning: "lamp", growth: "sprig",
  records: "torch", leaks: "amphora", mastery: "helmet", social: "owl",
};
export const emblemOf = (category: string): EmblemKey => CATEGORY_EMBLEM[category] ?? "unknown";
export const metalOf = (tier: string): Metal | null => (tier === "bronze" || tier === "silver" || tier === "gold" || tier === "platinum" ? tier : null);

/** «4 мин», «1 ч», «35 с». */
export function holdText(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return "—";
  if (sec < 60) return t("style.seconds", { count: Math.round(sec) });
  if (sec < 3600) return t("style.minutes", { count: Math.round(sec / 60) });
  return t("style.hours", { count: Math.round((sec / 3600) * 10) / 10 });
}

export type StyleRow = { key: string; label: string; share: number };
export type StyleGroup = { key: "horizon" | "side" | "price" | "hold"; title: string; rows: StyleRow[] };

export function styleGroups(s: Style): StyleGroup[] {
  return [
    { key: "horizon", title: t("style.horizon"), rows: (["intraday", "overnight", "swing"] as const).map((k) => ({ key: k, label: t(`style.h.${k}`), share: s.horizon[k] })) },
    { key: "side", title: t("style.side"), rows: (["long", "short"] as const).map((k) => ({ key: k, label: t(`style.s.${k}`), share: s.side[k] })) },
    { key: "price", title: t("style.price"), rows: PRICE_BUCKETS.map((k) => ({ key: k, label: t(`style.p.${k}`), share: s.price[k] })) },
    { key: "hold", title: t("style.hold"), rows: HOLD_BUCKETS.map((k) => ({ key: k, label: t(`style.d.${k}`), share: s.hold[k] })) },
  ];
}

// ─── year heat ──────────────────────────────────────────────────────────────

export type HeatCell = { day: string; net: number | null; trades: number; future: boolean };
export type HeatGrid = { weeks: { key: string; cells: HeatCell[] }[]; max: number; months: { col: number; month: number }[] };

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** 53 Monday-weeks × 5 weekdays ending with the week of `today`; months label the column where they start. */
export function heatGrid(calendar: readonly { day: string; net: number; trades: number }[], today: string, weeksBack = 53): HeatGrid {
  const byDay = new Map(calendar.map((c) => [c.day, c]));
  const end = new Date(`${today}T12:00:00Z`);
  const monday = new Date(end);
  monday.setUTCDate(end.getUTCDate() - ((end.getUTCDay() + 6) % 7));
  const start = new Date(monday);
  start.setUTCDate(monday.getUTCDate() - (weeksBack - 1) * 7);
  const weeks: HeatGrid["weeks"] = [];
  const months: HeatGrid["months"] = [];
  let max = 0;
  let lastMonth = -1;
  for (let w = 0; w < weeksBack; w++) {
    const cells: HeatCell[] = [];
    for (let d = 0; d < 5; d++) {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + w * 7 + d);
      const day = iso(date);
      const c = byDay.get(day);
      if (c) max = Math.max(max, Math.abs(c.net));
      cells.push({ day, net: c ? c.net : null, trades: c?.trades ?? 0, future: day > today });
    }
    const m = new Date(`${cells[0]!.day}T12:00:00Z`).getUTCMonth();
    if (m !== lastMonth) {
      months.push({ col: w, month: m });
      lastMonth = m;
    }
    weeks.push({ key: cells[0]!.day, cells });
  }
  return { weeks, max, months };
}

export const monthShort = (m: number): string => fmtMonth(m, "short");

// ─── radar ──────────────────────────────────────────────────────────────────

/** Point of axis `i` of `n` at `value` (0..100) on a radar of radius `r` centred at (cx, cy); axis 0 points up. */
export function radarPoint(i: number, n: number, value: number, r: number, cx: number, cy: number): [number, number] {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const k = (Math.max(0, Math.min(100, value)) / 100) * r;
  return [Math.round((cx + Math.cos(a) * k) * 100) / 100, Math.round((cy + Math.sin(a) * k) * 100) / 100];
}

export function radarPath(values: readonly number[], r: number, cx: number, cy: number): string {
  return values.map((v, i) => radarPoint(i, values.length, v, r, cx, cy)).map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ") + " Z";
}

/** Attributes in the fixed card order (missing keys → a low, empty attribute). */
export function orderedAttributes(list: readonly Attribute[]): Attribute[] {
  return ATTR_KEYS.map((k) => list.find((a) => a.key === k) ?? { key: k, score: null, sample: 0, minSample: 1, unit: "days", low: true, basis: "days", inputs: {}, deskMedian: null });
}

// ─── eras ───────────────────────────────────────────────────────────────────

export function eraTip(e: Era): string {
  return t("bio.eraTip", {
    month: monthName(e.month), net: usd(e.net), trades: commonI18n.t("units.trades", { count: e.trades }),
    days: t("hero.activeDays", { count: e.activeDays }),
  });
}

/** The last `n` eras (a long career keeps the strip readable). */
export const recentEras = (eras: readonly Era[], n = 18): Era[] => eras.slice(Math.max(0, eras.length - n));

export const personHref = (id: number): string => `/people/${id}`;

// ─── quotes ─────────────────────────────────────────────────────────────────

function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Quote ids on the profile's theme (a library tag), in a stable per-person order: the same person sees the same first
 * quote all day, «Другая цитата» walks the list. Falls back to the whole library when the tag is unknown.
 */
export function themeQuoteIds(quotes: readonly { id: string; tags: readonly string[] }[], theme: string, seed: string): string[] {
  const tagged = quotes.filter((q) => q.tags.includes(theme));
  const pool = tagged.length ? tagged : quotes;
  return pool.map((q) => ({ id: q.id, k: hash32(`${seed}\u0001${q.id}`) })).sort((a, b) => a.k - b.k || (a.id < b.id ? -1 : 1)).map((x) => x.id);
}

/** Path param of /people/:id → users.id (null for anything but a positive integer). */
export function parsePersonId(raw: string | undefined | null): number | null {
  if (!raw || !/^\d{1,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 ? n : null;
}
