/**
 * The daily loop's step by the phase of the day (next-step-model.ts): before the open «Напиши план», after the close
 * «Закрой день», then «Задача дня ждёт» (item 1.8). Since the composed dashboard (2026-10-25) it is not a card of its
 * own: «План на день» (components/dashboard/attention-panel.tsx) ranks it with the other tasks and shows ONE next step,
 * on the phone and on the desktop alike.
 */
import { useQuery } from "@tanstack/react-query";
import { trainerDailyQuery as dailyQuery } from "@/lib/api/queries";
import { contractDate } from "./daily-model";
import { useDailyMe, useTodayContract } from "./use-daily";
import { nextStep, type NextStep } from "./next-step-model";

/** The viewer's daily step; null while loading, for a role without the daily loop, or when disabled. */
export function useDailyNextStep(enabled: boolean, journalOpenDate?: string | null): { step: NextStep | null; today: string | null; isLoading: boolean } {
  const meQ = useDailyMe(enabled);
  const me = meQ.data ?? null;
  const session = me ? contractDate(me) : null;
  const planQ = useTodayContract(session, enabled && !!me);
  const late = me?.phase === "afterclose" || me?.phase === "weekend";
  const dailyQ = useQuery({ ...dailyQuery(), enabled: enabled && late, retry: false });
  if (!enabled || !me) return { step: null, today: null, isLoading: enabled && meQ.isLoading };
  const plan = planQ.isLoading ? undefined : (planQ.data ?? null);
  return { step: nextStep({ me, plan, journalOpenDate, daily: dailyQ.data ?? null }), today: me.today, isLoading: false };
}
