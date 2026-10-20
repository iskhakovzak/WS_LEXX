/**
 * «Задача дня» window texts (Волна 1, item 1.8): the ranked game is an evening task — open from the market close until
 * the next trading day's pick time (08:30 NY by default; server lib/trainer/daily challengeWindow). The trainer card
 * says it honestly: open → until when; closed → when the next one opens. Pure (unit-tested in daily-window.test.ts).
 */
import type { DailyChallengeState } from "@/lib/trainer/types";
import { fmtWeekday } from "@/lib/format";
import { trainerI18n } from "@/i18n/ns/trainer";

const CLOSE_TIME = "16:00";

/** «пт 08:30» — the weekday of the window edge with its NY time. */
function edge(e: { date: string; time: string }): string {
  return `${fmtWeekday(e.date, "short")} ${e.time}`;
}

export type DailyCardText = {
  /** The card's first line. */
  hint: string;
  /** The window line under it (open: until when), null when the hint already says it. */
  window: string | null;
  /** The ranked game can start now (older servers without `window`: true until it is revealed). */
  open: boolean;
};

export function dailyCardText(d: Pick<DailyChallengeState, "played" | "revealed" | "activeGameId" | "window">): DailyCardText {
  const t = trainerI18n.t;
  const w = d.window;
  const closed = w ? !w.open && d.activeGameId == null && !d.played : !d.played && d.revealed != null && d.activeGameId == null;
  if (d.played) return { hint: t("daily.playedHint"), window: null, open: !!w?.open };
  if (closed) return { hint: t("daily.closedHint", { time: w?.from.time ?? CLOSE_TIME }), window: null, open: false };
  return { hint: t("daily.hint"), window: w?.open ? t("daily.windowOpen", { until: edge(w.until) }) : null, open: true };
}

/** One line for other screens (the journal's «Задача дня ждёт» card): the window rule with its edges. */
export function dailyWindowRule(w: NonNullable<DailyChallengeState["window"]>): string {
  return trainerI18n.t("daily.windowRule", { from: w.from.time, until: w.until.time });
}
