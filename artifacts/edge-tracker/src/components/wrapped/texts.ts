/**
 * Every string drawn on the «Итоги» cards, in the UI language (owner rule: card text may follow the UI language).
 * model.ts decides what is on a card; this file only words it; render.ts only paints. Numbers: @/lib/format (trading
 * format, identical in RU / EN / UZ). User content (setups, goals, focus) and tickers are never translated.
 */
import { commonI18n } from "@/i18n/ns/common";
import { behaviorI18n } from "@/i18n/ns/behavior";
import { wrappedI18n } from "@/i18n/ns/wrapped";
import { fmtCount, fmtDate, fmtDateRange, fmtR, fmtRate, fmtUsd } from "@/lib/format";
import type { Tone } from "@/components/shared/share-canvas/canvas";
import type { CardKind, EdgeStat, Unit, WrappedCard, WrappedModel } from "./model";
import type { WrappedPeriod } from "./period";

export type StoryStat = { label: string; value: string };
export type StoryBar = { label: string; value: string; progress: number; pass: boolean };
export type StoryBlock = { label: string; title: string; value: string | null };

export interface StoryTexts {
  kind: CardKind;
  kicker: string;
  period: string;
  headline: string | null;
  big: string | null;
  sub: string | null;
  stats: StoryStat[];
  bars: StoryBar[];
  blocks: StoryBlock[];
  /** Discipline: one dot per trading day (true = clean). */
  dots: boolean[] | null;
  /** A paragraph: the focus itself (large) or the habit's advice. */
  quote: string | null;
  quoteLarge: boolean;
  note: string | null;
  tone: Tone;
  name: string | null;
  brand: string;
}

export interface SummaryTile { label: string; value: string; sub: string | null }
export interface SummaryTexts {
  title: string;
  period: string;
  big: string;
  sub: string;
  tiles: SummaryTile[];
  focusLabel: string;
  focus: string;
  tone: Tone;
  name: string | null;
  brand: string;
}

const BRAND = "WS_Desk";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** «Неделя 42 · 13–17 окт. 2026» / «Октябрь 2026». */
export function periodLabel(p: WrappedPeriod): string {
  if (p.kind === "month") return cap(fmtDate(`${p.key}-01`, "monthYear"));
  return wrappedI18n.t("period.week", { n: Number(p.key.slice(6)), range: fmtDateRange(p.from, p.to, "short") });
}

export function periodTitle(p: WrappedPeriod): string {
  return wrappedI18n.t(p.kind === "week" ? "title.week" : "title.month");
}

/** Value in the story's unit: «+$1,234» or «+3.2R». */
export function fmtValue(v: number | null | undefined, unit: Unit): string {
  return unit === "usd" ? fmtUsd(v, { signed: true, decimals: "auto" }) : fmtR(v);
}

/** A loss / cost shown as money lost: «−$420» (or «−1.5R»). */
const fmtCost = (v: number | null, unit: Unit) => (v == null ? "—" : unit === "usd" ? fmtUsd(-Math.abs(v), { signed: true, decimals: "auto" }) : fmtR(-Math.abs(v)));

/** The behaviour engine's hour bucket («10» → «10:00–11:00»; the pre-open label arrives in the UI language). */
export function hourText(label: string): string {
  if (label === "9:30") return behaviorI18n.t("prof.h930");
  if (label === "16+") return behaviorI18n.t("prof.after16");
  const h = Number(label);
  return Number.isFinite(h) && /^\d+$/.test(label) ? `${h}:00–${h + 1}:00` : label;
}

const dayShort = (ymd: string) => fmtDate(ymd, "dayMonth");
const sideText = (side: "long" | "short") => commonI18n.t(side === "short" ? "trading.short" : "trading.long");

function edgeValue(e: EdgeStat, unit: Unit): string {
  const t = wrappedI18n.t;
  const parts = [commonI18n.t("units.trades", { count: e.n })];
  if (e.winRate != null) parts.push(t("cards.edge.winRate", { wr: fmtRate(e.winRate) }));
  if (unit === "usd" && e.net != null) parts.unshift(fmtValue(e.net, "usd"));
  return parts.join(" · ");
}

export type TextOptions = { name: string | null };

const EMPTY: Omit<StoryTexts, "kind" | "kicker" | "period" | "tone" | "name" | "brand"> = {
  headline: null, big: null, sub: null, stats: [], bars: [], blocks: [], dots: null, quote: null, quoteLarge: false, note: null,
};

/** The texts of one story card. */
export function storyTexts(card: WrappedCard, model: Pick<WrappedModel, "period">, o: TextOptions): StoryTexts {
  const t = wrappedI18n.t;
  const c = commonI18n.t;
  const base = { ...EMPTY, kind: card.kind, period: periodLabel(model.period), name: o.name, brand: BRAND };
  const month = model.period.kind === "month";
  switch (card.kind) {
    case "net": {
      const tone: Tone = card.value == null || card.value === 0 ? null : card.value > 0 ? "profit" : "loss";
      if (!card.trades) return { ...base, kicker: t(month ? "cards.net.kickerMonth" : "cards.net.kickerWeek"), tone: null, big: t("cards.net.empty") };
      const stats: StoryStat[] = [
        { label: t("cards.net.trades"), value: fmtCount(card.trades) },
        { label: t("cards.net.winRate"), value: fmtRate(card.winRate) },
      ];
      if (card.bestDay) stats.push({ label: t("cards.net.bestDay"), value: `${dayShort(card.bestDay.date)} · ${fmtValue(card.bestDay.value, card.unit)}` });
      return {
        ...base, tone,
        kicker: t(month ? "cards.net.kickerMonth" : "cards.net.kickerWeek"),
        big: fmtValue(card.value, card.unit),
        sub: `${c("units.tradingDays", { count: card.tradingDays })} · ${t("cards.net.greenRed", { green: card.green, red: card.red })}`,
        stats,
      };
    }
    case "best": {
      const tr = card.trade;
      const stats: StoryStat[] = [];
      if (card.unit === "usd" && tr.r != null) stats.push({ label: "R", value: fmtR(tr.r) });
      if (tr.setup) stats.push({ label: t("cards.best.setup"), value: tr.setup });
      return {
        ...base, tone: "profit", kicker: t("cards.best.kicker"),
        headline: tr.ticker,
        sub: `${sideText(tr.side)} · ${dayShort(tr.day)}`,
        big: fmtValue(card.value, card.unit),
        stats,
      };
    }
    case "discipline": {
      const perfect = card.cleanDays === card.tradingDays;
      return {
        ...base, tone: card.cleanDays / card.tradingDays >= 0.8 ? "profit" : null, kicker: t("cards.discipline.kicker"),
        big: `${card.cleanDays}/${card.tradingDays}`,
        sub: t("cards.discipline.sub"),
        dots: card.days.map((d) => d.clean),
        stats: [{ label: t("cards.discipline.streak"), value: c("units.days", { count: card.streak }) }],
        note: perfect ? t("cards.discipline.perfect") : null,
      };
    }
    case "edge": {
      const blocks: StoryBlock[] = [];
      if (card.setup) blocks.push({ label: t("cards.edge.setup"), title: card.setup.label, value: edgeValue(card.setup, card.unit) });
      if (card.hour) blocks.push({ label: t("cards.edge.hour"), title: hourText(card.hour.label), value: edgeValue(card.hour, card.unit) });
      return { ...base, tone: "profit", kicker: t("cards.edge.kicker"), blocks };
    }
    case "lesson": {
      const kicker = t("cards.lesson.kicker");
      if (card.leak) {
        const stats: StoryStat[] = [
          { label: t("cards.lesson.habitTrades"), value: fmtCount(card.leak.trades) },
          { label: t("cards.lesson.habitDays"), value: fmtCount(card.leak.days) },
        ];
        return {
          ...base, tone: "loss", kicker, headline: card.leak.title,
          big: card.leak.cost != null ? fmtCost(card.leak.cost, "usd") : null,
          sub: card.leak.cost != null ? t("cards.lesson.costSub") : null,
          stats, quote: card.leak.advice,
        };
      }
      if (card.rules) {
        return {
          ...base, tone: "loss", kicker, headline: t("cards.lesson.rules"),
          big: card.rules.cost != null ? fmtCost(card.rules.cost, card.unit) : fmtCount(card.rules.trades),
          sub: card.rules.cost != null ? t("cards.lesson.rulesCost") : null,
          stats: [{ label: t("cards.lesson.habitTrades"), value: fmtCount(card.rules.trades) }],
        };
      }
      return { ...base, tone: "profit", kicker, headline: t("cards.lesson.clean"), quote: t("cards.lesson.cleanSub") };
    }
    case "progress":
      return {
        ...base, tone: card.ready ? "profit" : null,
        kicker: t("cards.progress.kicker", { stage: card.next }),
        big: t("cards.progress.passed", { passed: card.passed, total: card.total }),
        sub: t("cards.progress.criteria"),
        bars: card.criteria.map((x) => ({ label: x.label, value: `${x.value} / ${x.target}`, progress: x.progress, pass: x.pass })),
        note: card.ready ? t("cards.progress.ready") : card.stage ? t("cards.progress.current", { stage: card.stage }) : null,
      };
    case "focus":
      return {
        ...base, tone: null,
        kicker: t(month ? "cards.focus.kickerMonth" : "cards.focus.kickerWeek"),
        quote: card.text ?? t("cards.focus.none"), quoteLarge: true,
        note: card.source === "none" ? null : t(`cards.focus.${card.source}`),
      };
  }
}

/** The 1080×1350 card with the whole recap. */
export function summaryTexts(model: WrappedModel, o: TextOptions): SummaryTexts {
  const t = wrappedI18n.t;
  const c = commonI18n.t;
  const get = <K extends WrappedCard["kind"]>(k: K) => model.cards.find((x) => x.kind === k) as Extract<WrappedCard, { kind: K }> | undefined;
  const net = get("net");
  const tiles: SummaryTile[] = [];
  const best = get("best");
  if (best) tiles.push({ label: t("cards.best.kicker"), value: `${best.trade.ticker} ${fmtValue(best.value, best.unit)}`, sub: `${sideText(best.trade.side)} · ${dayShort(best.trade.day)}` });
  const disc = get("discipline");
  if (disc) tiles.push({ label: t("cards.discipline.kicker"), value: `${disc.cleanDays}/${disc.tradingDays}`, sub: t("cards.discipline.sub") });
  const edge = get("edge");
  if (edge?.setup) tiles.push({ label: t("cards.edge.setup"), value: edge.setup.label, sub: edgeValue(edge.setup, edge.unit) });
  if (edge?.hour) tiles.push({ label: t("cards.edge.hour"), value: hourText(edge.hour.label), sub: edgeValue(edge.hour, edge.unit) });
  const lesson = get("lesson");
  if (lesson?.leak) tiles.push({ label: t("cards.lesson.kicker"), value: lesson.leak.title, sub: lesson.leak.cost != null ? `${t("cards.lesson.cost")} ${fmtCost(lesson.leak.cost, "usd")}` : null });
  else if (lesson?.rules) tiles.push({ label: t("cards.lesson.kicker"), value: t("cards.lesson.rules"), sub: lesson.rules.cost != null ? fmtCost(lesson.rules.cost, lesson.unit) : c("units.trades", { count: lesson.rules.trades }) });
  const prog = get("progress");
  if (prog) tiles.push({ label: t("cards.progress.kicker", { stage: prog.next }), value: t("cards.progress.passed", { passed: prog.passed, total: prog.total }), sub: t("cards.progress.criteria") });
  const focus = get("focus");
  const v = net?.value ?? null;
  return {
    title: periodTitle(model.period),
    period: periodLabel(model.period),
    big: net && net.trades ? fmtValue(v, net.unit) : t("cards.net.empty"),
    sub: net && net.trades
      ? `${c("units.tradingDays", { count: net.tradingDays })} · ${t("cards.net.greenRed", { green: net.green, red: net.red })} · ${c("units.trades", { count: net.trades })}`
      : "",
    tiles: tiles.slice(0, 6),
    focusLabel: t(model.period.kind === "month" ? "cards.focus.kickerMonth" : "cards.focus.kickerWeek"),
    focus: focus?.text ?? t("cards.focus.none"),
    tone: v == null || v === 0 ? null : v > 0 ? "profit" : "loss",
    name: o.name,
    brand: BRAND,
  };
}

/** One line per card for screen readers (the canvas itself is an image). */
export function storyAlt(s: StoryTexts): string {
  return [s.kicker, s.headline, s.big, s.sub, ...s.blocks.map((b) => `${b.label}: ${b.title}${b.value ? ` (${b.value})` : ""}`),
    ...s.stats.map((x) => `${x.label}: ${x.value}`), ...s.bars.map((b) => `${b.label}: ${b.value}`), s.quote, s.note]
    .filter(Boolean).join(". ");
}

/** File names: «WS_Desk-week-2026-W42-1.png», «WS_Desk-month-2026-10-summary.png». */
export function fileNameOf(p: WrappedPeriod, part: number | "summary"): string {
  return `${BRAND}-${p.kind}-${p.key}-${part}.png`;
}

