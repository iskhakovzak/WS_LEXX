/**
 * Pure decisions of the /game-plan page (Волна 1): which tab opens (item 1.4), what the empty desk plan says (item 1.4),
 * which desk news make the morning summary (item 1.20) and what the suggested own rule line reads (item 1.9).
 * Unit-tested in plan-defaults.test.ts.
 */
import type { StreamItem } from "@/components/shared/stream/stream-api";
import { fmtDate } from "@/lib/format";
import { gpI18n } from "@/i18n/ns/gamePlan";
import { dateObj } from "./types";
import type { PlanPrefill } from "@/components/shared/plan-prefill";

export type PlanView = "desk" | "my" | "traders";

/** NY minutes of the regular open (09:30). */
export const OPEN_MIN = 9 * 60 + 30;

/**
 * The tab the page opens on: an explicit `?view=` wins; a trader with a personal plan opens «Мой план» (the step of the
 * loop that is theirs — the desk plan is summarised next to it); everyone else the desk plan.
 */
export function defaultPlanView(v: { url: PlanView | null; isTrader: boolean; canMine: boolean }): PlanView {
  if (v.url) return v.url;
  return v.isTrader && v.canMine ? "my" : "desk";
}

/** Which empty-state copy the desk plan shows when nothing is published for `date`. */
export type DeskEmptyKind = "late" | "today" | "ahead" | "future" | "past";

export function deskEmptyKind(v: { date: string; today: string; sessionAhead: boolean; nyDate: string; nyMinutes: number }): DeskEmptyKind {
  if (v.date === v.today) {
    if (v.sessionAhead) return "ahead";
    // After the open «the curator publishes before 9:30» is no longer true: say what happened instead.
    return v.nyDate === v.today && v.nyMinutes >= OPEN_MIN ? "late" : "today";
  }
  return v.date > v.today ? "future" : "past";
}

/** The empty desk plan's title for its kind. */
export function deskEmptyTitle(kind: DeskEmptyKind, date: string): string {
  const t = gpI18n.t;
  switch (kind) {
    case "late": return t("page.notPublishedTodayLate");
    case "today": return t("page.notPublishedToday");
    case "ahead": return t("page.notPublishedOn", { date: fmtDate(dateObj(date), "weekdayDayMonthLong") });
    case "future": return t("page.notPublishedOn", { date: fmtDate(dateObj(date), "dayMonthLong") });
    default: return t("page.neverPublished", { date: fmtDate(dateObj(date), "dayMonthLong") });
  }
}

/** Kinds the desk plan already shows itself (the plan, the macro strip) — never repeated in «Новости деска». */
const OWN_KINDS = new Set<StreamItem["kind"]>(["game_plan", "event"]);
export const NEWS_MAX = 6;

/**
 * «Новости деска» of the morning: the auto feed of the previous session and of the plan's day, newest first, without
 * what the plan page already shows; at most NEWS_MAX items (the full feed is one link away).
 */
export function deskNews(items: readonly StreamItem[], from: string, to: string, max = NEWS_MAX): StreamItem[] {
  const seen = new Set<string>();
  const out: StreamItem[] = [];
  for (const it of [...items].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))) {
    if (seen.has(it.id) || OWN_KINDS.has(it.kind) || it.date < from || it.date > to) continue;
    seen.add(it.id);
    out.push(it);
    if (out.length >= max) break;
  }
  return out;
}

/** A manual daily-feed post of the day, as «Сегодня важно» shows it (only the filled parts). */
export type DayPost = { id: number; author: string | null; theme: string | null; works: string | null; doesntWork: string | null; tickers: string[]; notes: string | null };

type FeedEntryLike = {
  id: number; date: string; createdBy?: string | null; marketTheme?: string | null; whatWorksNow?: string | null; whatDoesntWork?: string | null;
  bestTickers?: string | null; notes?: string | null;
};

const clean = (s: string | null | undefined): string | null => {
  const v = String(s ?? "").trim();
  return v ? v : null;
};

/** «Сегодня важно»: the day's manual posts (daily_feed), empty ones dropped. */
export function dayPosts(entries: readonly FeedEntryLike[], date: string): DayPost[] {
  return entries
    .filter((e) => e.date.slice(0, 10) === date)
    .map((e) => ({
      id: e.id,
      author: clean(e.createdBy),
      theme: clean(e.marketTheme),
      works: clean(e.whatWorksNow),
      doesntWork: clean(e.whatDoesntWork),
      tickers: String(e.bestTickers ?? "").split(/[\s,;/]+/).map((x) => x.trim().toUpperCase()).filter(Boolean),
      notes: clean(e.notes),
    }))
    .filter((p) => p.theme || p.works || p.doesntWork || p.tickers.length || p.notes);
}

/** GET /api/game-plan/my/prefill (api lib/planPrefill) — the type lives with its hook in components/shared/plan-prefill. */
export type { PlanPrefill };

/** The suggestion is worth a chip only when it differs from what the plan already has as the rule. */
export function showRuleSuggestion(prefill: PlanPrefill | null | undefined, current: string | null | undefined): boolean {
  return !!prefill?.rule && prefill.rule.mistake !== current;
}
