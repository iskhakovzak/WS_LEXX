/**
 * Trade structure on the client: role labels / tags, role of an execution (API role or derived from its kind),
 * and the step series of the running position and its average price. Pure.
 */
import type { Execution, ExecutionKind, Fill, Side, TradeRole } from "../types";
import { fmtPrice, fmtQty } from "./format";

export const ROLE_LABEL: Record<TradeRole, string> = {
  entry: "Вход",
  reentry: "Перезаход",
  flip: "Переворот",
  add: "Добор",
  partial_exit: "Частичный фикс",
  exit: "Выход",
  stop: "Стоп",
};

/** Short tag drawn next to the marker on the chart. */
export const ROLE_TAG: Record<TradeRole, string> = {
  entry: "Вход",
  reentry: "Перезаход",
  flip: "Переворот",
  add: "Добор",
  partial_exit: "Фикс",
  exit: "Выход",
  stop: "Стоп",
};

/** Order of the marker key under the chart. */
export const ROLE_ORDER: readonly TradeRole[] = ["entry", "reentry", "flip", "add", "partial_exit", "exit", "stop"];

const KIND_ROLE: Record<ExecutionKind, TradeRole> = { entry: "entry", add: "add", trim: "partial_exit", exit: "exit", stop: "stop" };

export function roleFromKind(kind: ExecutionKind): TradeRole {
  return KIND_ROLE[kind] ?? "entry";
}

/** The API's role when present, else the one implied by the stored kind. */
export function roleOf(e: Pick<Execution, "kind" | "role">): TradeRole {
  return e.role && e.role in ROLE_LABEL ? e.role : roleFromKind(e.kind);
}

export function roleLabel(role: TradeRole, inferred = false): string {
  return `${ROLE_LABEL[role]}${inferred ? "?" : ""}`;
}

/** Marker label: «Добор 10.50 × 100». */
export function fillLabelOf(role: TradeRole, inferred: boolean, price: number, qty: number | null): string {
  return `${roleLabel(role, inferred)} ${fmtPrice(price)}${qty != null ? ` × ${fmtQty(qty)}` : ""}`;
}

/** Tooltip lines of a marker: role, price, size, share of the max position, R, pieces, why. */
export function fillDetails(f: Fill): string[] {
  const out: string[] = [];
  const head = [`${roleLabel(f.role, f.inferred)} ${fmtPrice(f.price)}`];
  if (f.qty != null) head.push(`× ${fmtQty(f.qty)} шт.`);
  out.push(head.join(" "));
  const leg = f.leg;
  const extra: string[] = [];
  if (leg?.fraction != null && leg.fraction < 0.999) extra.push(`${Math.round(leg.fraction * 100)}% позиции`);
  if (leg?.positionAfter != null) extra.push(leg.positionAfter > 0 ? `в позиции ${fmtQty(leg.positionAfter)}` : "позиция закрыта");
  if (leg?.avgAfter != null && leg.opening) extra.push(`ср. ${fmtPrice(leg.avgAfter)}`);
  if (leg?.r != null) extra.push(`${leg.r >= 0 ? "+" : "−"}${Math.abs(leg.r).toFixed(2)}R`);
  else if (leg?.perShare != null && !leg.opening) extra.push(`${leg.perShare >= 0 ? "+" : "−"}${fmtPrice(Math.abs(leg.perShare))} / акц.`);
  if (f.pieces > 1) extra.push(`${f.pieces} исполнения одного ордера`);
  if (extra.length) out.push(extra.join(" · "));
  if (leg?.reason) out.push(leg.reason);
  return out;
}

export type PositionStep = {
  /** Bar index where this state starts. */
  fromIdx: number;
  /** Bar index of the next change (or of the last fill). */
  toIdx: number;
  /** Average cost of the open position (null when flat). */
  avg: number | null;
  /** Open shares (null when quantities are unknown). */
  qty: number | null;
};

/**
 * Running average price / position after every fill (average-cost method; closing fills keep the average).
 * Unknown quantities: every fill counts as one unit for the average, a full exit / stop flattens, `qty` stays null.
 */
export function positionSteps(fills: readonly Fill[], opening: (f: Fill) => boolean): PositionStep[] {
  if (!fills.length) return [];
  const known = fills.every((f) => f.qty != null);
  let pos = 0, cost = 0;
  const out: PositionStep[] = [];
  for (let i = 0; i < fills.length; i++) {
    const f = fills[i];
    const u = known ? (f.qty as number) : 1;
    if (opening(f)) { cost += f.price * u; pos += u; }
    // Sizes unknown: a full exit / stop closes whatever is left (units are only a stand-in for shares).
    else if (!known && (f.role === "exit" || f.role === "stop")) { pos = 0; cost = 0; }
    else if (pos > 1e-9) { const avg = cost / pos; const q = Math.min(u, pos); cost -= avg * q; pos -= q; }
    const next = fills[i + 1];
    const state = { avg: pos > 1e-9 ? cost / pos : null, qty: known ? Math.max(0, pos) : null };
    const prev = out[out.length - 1];
    if (prev && prev.fromIdx === f.idx) { prev.avg = state.avg; prev.qty = state.qty; prev.toIdx = next ? next.idx : f.idx; continue; }
    out.push({ fromIdx: f.idx, toIdx: next ? next.idx : f.idx, ...state });
  }
  return out;
}

/** «Перезаход №2» / «Переворот» / «Сделка #12» for a sibling trade. */
export function siblingTitle(s: { id: number; reentryIndex: number; legs: { role: TradeRole }[] }): string {
  if (s.legs[0]?.role === "flip") return "Переворот";
  return s.reentryIndex > 0 ? `Перезаход №${s.reentryIndex}` : "Первый вход";
}

export function sideWord(side: Side): string {
  return side === "short" ? "шорт" : "лонг";
}
