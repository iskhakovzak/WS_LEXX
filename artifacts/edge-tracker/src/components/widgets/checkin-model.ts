import type { Tone } from "@/components/ds";

export type CheckinFlags = {
  sleepWell: boolean;
  focused: boolean;
  stressed: boolean;
  anxious: boolean;
  tilted: boolean;
  revenge: boolean;
};

export type CheckinRow = CheckinFlags & {
  id: number;
  userId: string;
  date: string;
  freeText: string | null;
  readiness?: number;
  createdAt: string;
};

export type Agg = { days: number; trades: number; winRate: number | null; avgR: number | null };

export type CheckinInsights = {
  from: string;
  to: string;
  streak: number;
  days: Array<CheckinFlags & { date: string; readiness: number; hasNote: boolean; trades: number; winRate: number | null; avgR: number | null; pnl: number | null }>;
  overall: Agg;
  highReadiness: Agg;
  lowReadiness: Agg;
  noCheckin: Agg;
  flags: Array<{ key: keyof CheckinFlags; with: Agg; without: Agg }>;
};

/** Same formula as the API (lib/weeklyPsychologyReport.readinessScore). */
export function readiness(s: CheckinFlags): number {
  let score = 50;
  if (s.sleepWell) score += 20;
  if (s.focused) score += 30;
  if (s.stressed) score -= 15;
  if (s.anxious) score -= 15;
  if (s.tilted) score -= 25;
  if (s.revenge) score -= 25;
  return Math.max(0, Math.min(100, score));
}

export function readinessTone(score: number | null | undefined): Tone {
  if (score == null) return "neutral";
  if (score >= 70) return "up";
  if (score >= 50) return "warn";
  return "down";
}

export function readinessLabel(score: number): string {
  if (score >= 80) return "Готов к сессии";
  if (score >= 70) return "В рабочем состоянии";
  if (score >= 50) return "Торгуй аккуратно";
  if (score >= 30) return "Сократи размер";
  return "Лучше пропустить сессию";
}

export const FLAG_LABEL: Record<keyof CheckinFlags, string> = {
  sleepWell: "Выспался",
  focused: "В фокусе",
  stressed: "Стресс",
  anxious: "Тревога",
  tilted: "Тильт",
  revenge: "Хочу отыграться",
};

export const NEGATIVE_FLAGS = ["stressed", "anxious", "tilted", "revenge"] as const;
