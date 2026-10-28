/**
 * The timing axis on the client (codes from the api lib/sessionFlow/timing.ts — derived from the fills, never typed).
 * Display order = the time of day, then the holds.
 */
import { sessionFlowI18n } from "@/i18n/ns/sessionFlow";

export const TIMINGS = ["am", "opg", "open30", "day", "moc", "pm", "opg_day", "overnight", "swing"] as const;
export type Timing = (typeof TIMINGS)[number];

export const isTiming = (v: unknown): v is Timing => typeof v === "string" && (TIMINGS as readonly string[]).includes(v);

/** Intraday timings and the holds — the two rows of the setup's matrix. */
export const INTRADAY_TIMINGS: readonly Timing[] = ["am", "opg", "open30", "day", "moc", "pm"];
export const HOLD_TIMINGS: readonly Timing[] = ["opg_day", "overnight", "swing"];

/** Display text of a timing code («none» and unknown codes → «без тайминга»). */
export function timingLabel(code: string): string {
  return isTiming(code) ? sessionFlowI18n.t(`timing.${code}`) : sessionFlowI18n.t("timing.none");
}

/** Toggle one timing in an allow-list (kept in display order). */
export function toggleTiming(list: readonly Timing[], t: Timing): Timing[] {
  const set = new Set(list);
  if (set.has(t)) set.delete(t); else set.add(t);
  return TIMINGS.filter((k) => set.has(k));
}
