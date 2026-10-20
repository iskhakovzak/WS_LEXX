/**
 * WS_NEWS channel briefs — text (pure: data → Telegram HTML). Texts from the server `newsChannel` namespace, the
 * channel language is Russian (NEWS_LANG). Layout:
 *
 *   ☀️ <b>Премаркет</b> · вт, 20 окт.          header (always)
 *   <blank>
 *   🚀 <b>Гэпы вверх</b>                          section = emoji header + lines; an empty section is dropped
 *   $ABCD +12.34% · RVOL 3.2 · флоат 12.3M
 *   …
 *   🔗 Темы рынка на сайте                       footer link (only with a site URL)
 *
 * Tickers are $TICKER (Telegram cashtags), moves signed with 2 decimals, every stored text (theme names, calendar
 * texts) HTML-escaped. Nothing to say (every section empty) ⇒ null, the post is not sent. The text never exceeds
 * TG_MAX_CHARS: lines are dropped from the end of the last sections first.
 */
import { newsChannelT } from "../../i18n/ns";
import { fmtDateFor } from "../../i18n/format";
import type { CloseData, EarningsItem, GapRow, Mover, OpenData, PostData, PremarketData, ThemeMove } from "./data";
import { NEWS_LANG } from "./data";

export const TG_MAX_CHARS = 4096;

export type RenderCaps = { gappers: number; earnings: number; movers: number };
export type RenderOpts = { caps: RenderCaps; siteUrl?: string | null };

const t = newsChannelT.tFor(NEWS_LANG);

/** Telegram HTML: & < > (and quotes, for attribute values). */
export function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** +1.23% / -0.50% / 0.00% */
export function signedPct(v: number): string {
  const r = Math.round(v * 100) / 100;
  const s = (Object.is(r, -0) ? 0 : r).toFixed(2);
  return r > 0 ? `+${s}%` : `${s}%`;
}

/** 950 / 12.3K / 4.5M / 245B / 3.1T (shares or USD). */
export function compact(v: number): string {
  const a = Math.abs(v);
  const fmt = (x: number, suffix: string) => `${x >= 100 ? Math.round(x) : Math.round(x * 10) / 10}${suffix}`;
  if (a >= 1e12) return fmt(v / 1e12, "T");
  if (a >= 1e9) return fmt(v / 1e9, "B");
  if (a >= 1e6) return fmt(v / 1e6, "M");
  if (a >= 1e3) return fmt(v / 1e3, "K");
  return String(Math.round(v));
}

const cashtag = (ticker: string) => `$${esc(ticker.toUpperCase())}`;

type Section = { head: string; lines: string[] };
const section = (emoji: string, title: string, lines: string[]): Section => ({ head: `${emoji} <b>${esc(title)}</b>`, lines });

function gapLine(g: GapRow): string {
  const parts = [`${cashtag(g.ticker)} ${signedPct(g.gapPct)}`];
  if (g.relVolume != null) parts.push(esc(t("label.rvol", { value: g.relVolume.toFixed(1) })));
  if (g.float != null && g.float > 0) parts.push(esc(t("label.float", { value: compact(g.float) })));
  return parts.join(" · ");
}

/** The dot follows the sign (a «laggard» may still be up on a strong day). */
const dotOf = (pct: number) => (pct > 0 ? "🟢" : pct < 0 ? "🔴" : "⚪");

function themeLine(m: ThemeMove): string {
  const dot = dotOf(m.pct);
  const top = m.top ? ` · ${cashtag(m.top.ticker)} ${signedPct(m.top.pct)}` : "";
  return `${dot} ${esc(m.name)} <b>${signedPct(m.pct)}</b>${top}`;
}

const moverLine = (m: Mover) => `${cashtag(m.ticker)} <b>${signedPct(m.pct)}</b>${m.theme ? ` · ${esc(m.theme)}` : ""}`;

function earningsLine(label: string, items: readonly EarningsItem[], cap: number): string | null {
  if (!items.length) return null;
  const shown = items.slice(0, cap).map((e) => (e.marketCap != null && e.marketCap > 0 ? `${cashtag(e.ticker)} (${compact(e.marketCap)})` : cashtag(e.ticker)));
  const more = items.length > cap ? ` ${esc(t("earnings.more", { count: items.length - cap }))}` : "";
  return `<i>${esc(label)}:</i> ${shown.join(", ")}${more}`;
}

function themeSections(d: { leaders: ThemeMove[]; laggards: ThemeMove[] }): Section[] {
  return [
    section("📈", t("section.leaders"), d.leaders.map(themeLine)),
    section("📉", t("section.laggards"), d.laggards.map(themeLine)),
  ];
}

function premarketSections(d: PremarketData, caps: RenderCaps): Section[] {
  const earnings = [earningsLine(t("earnings.bmo"), d.earnings.bmo, caps.earnings), earningsLine(t("earnings.amc"), d.earnings.amc, caps.earnings)];
  return [
    section("🚀", t("section.gapUp"), d.gapUp.slice(0, caps.gappers).map(gapLine)),
    section("🔻", t("section.gapDown"), d.gapDown.slice(0, caps.gappers).map(gapLine)),
    ...themeSections(d),
    section("📊", t("section.earnings"), earnings.filter((l): l is string => l != null)),
    section("🗓", t("section.macro"), d.macro.map((m) => `• ${esc(m.name)}${m.description ? ` — ${esc(m.description)}` : ""}`)),
  ];
}

const openSections = (d: OpenData, caps: RenderCaps): Section[] => [
  ...themeSections(d),
  section("⚡", t("section.movers"), d.movers.slice(0, caps.movers).map(moverLine)),
];

const closeSections = (d: CloseData, caps: RenderCaps): Section[] => [
  ...themeSections(d),
  section("🌙", t("section.afterHours"), d.afterHours.slice(0, caps.movers).map(moverLine)),
];

const HEADER_EMOJI = { premarket: "☀️", open: "🔔", close: "🌆" } as const;

/** Joins header + sections + footer and drops lines from the end until the text fits `max`. */
export function fitMessage(header: string, sections: readonly Section[], footer: string | null, max = TG_MAX_CHARS): string {
  const secs = sections.filter((s) => s.lines.length).map((s) => ({ head: s.head, lines: [...s.lines] }));
  const build = () => [header, ...secs.map((s) => [s.head, ...s.lines].join("\n")), ...(footer ? [footer] : [])].join("\n\n");
  let text = build();
  while (text.length > max && secs.length) {
    const last = secs[secs.length - 1]!;
    last.lines.pop();
    if (!last.lines.length) secs.pop();
    text = build();
  }
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf("\n"), 0)) || cut.replace(/<[^>]*$/, ""); // header alone too long: last whole line
}

/** The post's Telegram HTML, or null when every section is empty (nothing worth posting). */
export function renderPost(d: PostData, o: RenderOpts): string | null {
  const sections = d.post === "premarket" ? premarketSections(d, o.caps) : d.post === "open" ? openSections(d, o.caps) : closeSections(d, o.caps);
  if (!sections.some((s) => s.lines.length)) return null;
  const header = `${HEADER_EMOJI[d.post]} <b>${esc(t(`title.${d.post}`))}</b> · ${esc(fmtDateFor(NEWS_LANG, d.date, "weekdayDayMonth"))}`;
  const site = o.siteUrl?.trim().replace(/\/+$/, "");
  const footer = site && /^https?:\/\//.test(site) ? `🔗 <a href="${esc(`${site}/themes`)}">${esc(t("footer"))}</a>` : null;
  return fitMessage(header, sections, footer);
}
