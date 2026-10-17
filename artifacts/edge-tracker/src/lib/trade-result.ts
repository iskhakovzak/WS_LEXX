import type { Tone } from "@/components/ds";

export type TradeResult = "win" | "loss" | "be" | null;

export function normalizeResult(result: string | null | undefined): TradeResult {
  const r = result?.trim().toLowerCase();
  if (r === "win" || r === "прибыль" || r === "профит") return "win";
  if (r === "loss" || r === "убыток" || r === "лосс") return "loss";
  if (r === "be" || r === "breakeven" || r === "безубыток" || r === "бу") return "be";
  return null;
}

/** Design-system tone for a result (use with <Pill tone=…>). */
export function resultTone(result: string | null | undefined): Tone {
  const r = normalizeResult(result);
  if (r === "win") return "up";
  if (r === "loss") return "down";
  if (r === "be") return "warn";
  return "neutral";
}

/** Row accent: 2px coloured left bar + soft hover tint (token colours only). */
export function resultRowClass(result: string | null | undefined): string {
  const r = normalizeResult(result);
  if (r === "win") return "border-l-up/60 hover:bg-up/5";
  if (r === "loss") return "border-l-down/60 hover:bg-down/5";
  if (r === "be") return "border-l-[hsl(var(--chart-3)/0.6)] hover:bg-[var(--glass-hover-bg)]";
  return "border-l-border hover:bg-[var(--glass-hover-bg)]";
}

/** Pill-shaped badge colours. Callers add their own padding/size classes. */
export function resultBadgeClass(result: string | null | undefined): string {
  const r = normalizeResult(result);
  const base = "rounded-full tabular-nums";
  if (r === "win") return `${base} bg-up/15 text-up`;
  if (r === "loss") return `${base} bg-down/15 text-down`;
  if (r === "be") return `${base} bg-[hsl(var(--chart-3)/0.15)] text-[hsl(var(--chart-3))]`;
  return `${base} bg-[var(--glass-bg)] text-muted-foreground`;
}

export function resultLabel(result: string | null | undefined): string {
  const r = normalizeResult(result);
  if (r === "win") return "WIN";
  if (r === "loss") return "LOSS";
  if (r === "be") return "BE";
  return result?.toUpperCase() ?? "—";
}

/** Russian long label, e.g. for tooltips / aria-labels. */
export function resultLabelRu(result: string | null | undefined): string {
  const r = normalizeResult(result);
  if (r === "win") return "Прибыль";
  if (r === "loss") return "Убыток";
  if (r === "be") return "Безубыток";
  return "Без результата";
}

