import type { Tone } from "@/components/ds";
import { commonI18n } from "@/i18n/ns/common";
import { classifyPnl, getBeRange } from "@/lib/appearance/be-range";

export type TradeResult = "win" | "loss" | "be" | null;

export function normalizeResult(result: string | null | undefined): TradeResult {
  const r = result?.trim().toLowerCase();
  // Legacy stored values (Russian synonyms written by older imports) are parsed, never shown. i18n-ignore
  if (r === "win" || r === "прибыль" || r === "профит") return "win"; // i18n-ignore
  if (r === "loss" || r === "убыток" || r === "лосс") return "loss"; // i18n-ignore
  if (r === "be" || r === "breakeven" || r === "безубыток" || r === "бу") return "be"; // i18n-ignore
  return null;
}

/**
 * The result a trade row *shows* («Вид» → Деньги → break-even range): the stored result, except that a P&L inside
 * ±range reads as BE. Colour / label only; the stored result and every analytics number stay as they are.
 * Without a P&L (open trade, no data) the stored result is shown as is.
 */
export function visualResult(result: string | null | undefined, pnl: number | null | undefined, beRange: number = getBeRange()): TradeResult {
  return classifyPnl(pnl, beRange) === "be" ? "be" : normalizeResult(result);
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
  if (r === "be") return "border-l-be/60 hover:bg-[var(--glass-hover-bg)]";
  return "border-l-border hover:bg-[var(--glass-hover-bg)]";
}

/** Pill-shaped badge colours. Callers add their own padding/size classes. */
export function resultBadgeClass(result: string | null | undefined): string {
  const r = normalizeResult(result);
  const base = "rounded-full tabular-nums";
  if (r === "win") return `${base} bg-up/15 text-up`;
  if (r === "loss") return `${base} bg-down/15 text-down`;
  if (r === "be") return `${base} bg-be/15 text-be`;
  return `${base} bg-[var(--glass-bg)] text-muted-foreground`;
}

export function resultLabel(result: string | null | undefined): string {
  const r = normalizeResult(result);
  if (r === "win") return "WIN";
  if (r === "loss") return "LOSS";
  if (r === "be") return "BE";
  return result?.toUpperCase() ?? "—";
}

/** Long label in the UI language (tooltips / aria-labels). The name is historical: it follows the UI language. */
export function resultLabelRu(result: string | null | undefined): string {
  const r = normalizeResult(result);
  return commonI18n.t(r ? `tradeResult.${r}` : "tradeResult.none");
}

