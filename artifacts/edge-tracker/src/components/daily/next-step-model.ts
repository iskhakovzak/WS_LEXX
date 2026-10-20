/**
 * «Следующий шаг» on the phone (Волна 1, item 1.3): ONE block at the top of the dashboard that merges the day line and
 * «Что важно сейчас» by the phase of the day — before the open «Напиши план», during the session the contract + focus,
 * after the close «Закрой день» (then «Задача дня ждёт», item 1.8, then tomorrow's plan). P&L and the limit sit below.
 * Pure: the card (next-step-card.tsx) renders what this decides; unit-tested in __tests__/next-step-model.test.ts.
 */
import type { DailyMe } from "@/lib/daily/types";
import type { DailyChallengeState } from "@/lib/trainer/types";
import { links } from "@/lib/links";
import { contractDate, type PlanContract } from "./daily-model";

export type NextStepKind =
  /** Write the plan (contract) for `date` — before the open, or for the next session once the day is closed. */
  | "plan"
  /** In the session (or the plan is written): today's contract + focus are the step; the plan is one tap away. */
  | "contract"
  /** After the close: close the finished day `date` in the journal (the one evening form). */
  | "close"
  /** The day is closed and «Задача дня» waits (ranked until 08:30 NY). */
  | "task"
  /** Day closed, tomorrow's plan written: nothing left — rest. */
  | "done";

export type NextStep = {
  kind: NextStepKind;
  /** The day the step is about (plan / contract: the session; close: the finished day). */
  date: string;
  href: string | null;
  /** close: the finished day's numbers. */
  trades?: number;
  netPnl?: number | null;
};

/** The plan has a row for the session (any contract field set, or a written plan doc). */
export function planWritten(plan: PlanContract | null | undefined): boolean {
  return plan != null;
}

/** The ranked «Задача дня» can be played now by the viewer (window open, not finished). */
export function dailyTaskOpen(d: Pick<DailyChallengeState, "played" | "window" | "revealed"> | null | undefined): boolean {
  if (!d || d.played) return false;
  return d.window ? d.window.open : false;
}

export function nextStep(v: {
  me: DailyMe | null | undefined;
  /** Today's (the session's) own contract — null: no personal plan yet; undefined: still loading. */
  plan: PlanContract | null | undefined;
  /** The journal day the viewer still has to close (dashboard EOD status), if any. */
  journalOpenDate?: string | null;
  daily?: Pick<DailyChallengeState, "played" | "window" | "revealed"> | null;
}): NextStep | null {
  const me = v.me;
  if (!me) return null;
  const session = contractDate(me);
  const late = me.phase === "afterclose" || me.phase === "weekend";
  const card = me.evening && me.evening.trades > 0 ? me.evening : null;
  if (late) {
    const openDay = v.journalOpenDate ?? (card && !card.reviewed ? card.date : null);
    if (openDay) {
      const same = card && card.date === openDay ? card : null;
      return { kind: "close", date: openDay, href: links.journalDay(openDay, me.evening?.trader), trades: same?.trades, netPnl: same?.netPnl ?? null };
    }
    if (dailyTaskOpen(v.daily)) return { kind: "task", date: session, href: "/trainer" };
    if (v.plan === undefined) return { kind: "contract", date: session, href: links.myPlan(session) };
    return planWritten(v.plan) ? { kind: "done", date: session, href: null } : { kind: "plan", date: session, href: links.myPlan(session) };
  }
  if (me.phase === "premarket" && v.plan !== undefined && !planWritten(v.plan)) {
    return { kind: "plan", date: session, href: links.myPlan(session) };
  }
  return { kind: "contract", date: session, href: links.myPlan(session) };
}
