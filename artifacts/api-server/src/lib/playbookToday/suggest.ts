/**
 * «В плейбук» preselect (ROMAN-09) — PURE: which office setup a trade most likely belongs to, so the quick-add dialog
 * does not open on «0.1 Утренняя подготовка» (the first name alphabetically).
 *   1. strategy: the trade's broker / auto label maps to a setup code (./relinkMap codeForLabel) and the entry time fits
 *      that setup's window (± 5 min) — the same rule the history relink used;
 *   2. time: the setups whose window holds the entry minute (the routine card and premarket-only setups never), the
 *      narrowest window first («9:40» → 1.x opening setups before 2.1 VWAP Hold 10:00–15:00) — unless the label names a
 *      family the office has no setup for (OPG / IMBX auctions …): then nothing is guessed.
 */
import { codeFromName, parseTimeRange } from "./build";
import { codeForLabel, entryMinuteOf, isExcludedLabel } from "./relinkMap";

export type SuggestSetup = { id: number; name: string; timeOfDay: string | null; space: string; canAddExamples: boolean };
export type SuggestTrade = { setup: string | null; autoSetup?: string | null; openedAt: string | null };
export type TradeSuggestion = { id: number; via: "strategy" | "time"; label: string | null; time: string | null };

const TOLERANCE_MIN = 5;
const OPEN_MIN = 9 * 60 + 30;
const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const hmOf = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

export function suggestByTrade(t: SuggestTrade, setups: readonly SuggestSetup[]): TradeSuggestion[] {
  const entry = entryMinuteOf(t.openedAt);
  const office = setups.filter((s) => s.space === "office" && s.canAddExamples);
  const windowOf = (s: SuggestSetup) => {
    const r = parseTimeRange(s.timeOfDay);
    return r ? { from: toMin(r.from), to: toMin(r.to) } : null;
  };
  const fits = (s: SuggestSetup) => {
    const w = windowOf(s);
    return !w || (entry != null && entry >= w.from - TOLERANCE_MIN && entry <= w.to + TOLERANCE_MIN);
  };
  const out: TradeSuggestion[] = [];
  const push = (x: TradeSuggestion) => { if (!out.some((o) => o.id === x.id)) out.push(x); };
  for (const label of [t.setup, t.autoSetup]) {
    const code = codeForLabel(label);
    const s = code ? office.find((x) => codeFromName(x.name) === code) : undefined;
    if (s && label && fits(s)) push({ id: s.id, via: "strategy", label, time: entry != null ? hmOf(entry) : null });
  }
  // A family the office has no setup for (an OPG / IMBX auction trade …): no guess by time — the trader picks.
  const excluded = [t.setup, t.autoSetup].some((l) => isExcludedLabel(l));
  if (!excluded && entry != null && entry >= OPEN_MIN) {
    const inWindow = office
      .map((s) => ({ s, w: windowOf(s) }))
      .filter((x): x is { s: SuggestSetup; w: { from: number; to: number } } => !!x.w && x.w.from >= OPEN_MIN - TOLERANCE_MIN && entry >= x.w.from && entry <= x.w.to)
      .sort((a, b) => (a.w.to - a.w.from) - (b.w.to - b.w.from) || a.w.from - b.w.from);
    for (const { s } of inWindow.slice(0, 3)) push({ id: s.id, via: "time", label: null, time: hmOf(entry) });
  }
  return out;
}
