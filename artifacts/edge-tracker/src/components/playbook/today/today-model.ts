/**
 * «Сегодня» — pure view logic over the PlaybookToday contract (lib/playbook-today/types): the NY clock and the day
 * map, the live checklist grade, the size calculator, the «где у тебя преимущество» summary and the prefill of
 * «Сегодня торгую». No React, no fetching — the tests cover every rule with fixtures.
 */
import type { DayWindow, DayWindowKey, MyEdge, PlaybookToday, TodaySetup } from "@/lib/playbook-today/types";

export const MAX_PICKS = 3;
export const WINDOW_ORDER: readonly DayWindowKey[] = ["premarket", "open", "trend", "close"];

/* ── clock ──────────────────────────────────────────────────────────────── */

/** "09:30" → 570; anything unparsable → null. */
export function hm(v: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** 570 → "09:30". */
export function hmText(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Dev / test override of the NY clock: `?ny=08:45` on the URL (dev builds only, so a reviewer can see the morning
 * state at any hour). Returns minutes or null.
 */
export function nyOverride(search: string, dev: boolean): number | null {
  if (!dev) return null;
  return hm(new URLSearchParams(search).get("ny"));
}

/** The NY minute now, from the server's minute at fetch time plus the time since. */
export function nyNow(serverMinutes: number, fetchedAt: number, now: number): number {
  return serverMinutes + Math.max(0, Math.floor((now - fetchedAt) / 60_000));
}

export type WindowPhase = "past" | "now" | "next" | "later";

/** Where each window stands at `now`: at most one "now" and one "next" (the first window still ahead). */
export function windowPhases(windows: DayWindow[], now: number): Record<string, WindowPhase> {
  const out: Record<string, WindowPhase> = {};
  let nextSet = false;
  for (const w of windows) {
    const from = hm(w.from) ?? 0;
    const to = hm(w.to) ?? 0;
    if (now >= to) out[w.key] = "past";
    else if (now >= from) out[w.key] = "now";
    else if (!nextSet) { out[w.key] = "next"; nextSet = true; }
    else out[w.key] = "later";
  }
  return out;
}

/** The marker on the day map: which window and how far into it (0..1); before the first / after the last → edges. */
export function nowMarker(windows: DayWindow[], now: number): { key: DayWindowKey; frac: number; state: "before" | "in" | "after" } | null {
  if (!windows.length) return null;
  const first = windows[0];
  const last = windows[windows.length - 1];
  if (now < (hm(first.from) ?? 0)) return { key: first.key, frac: 0, state: "before" };
  if (now >= (hm(last.to) ?? 0)) return { key: last.key, frac: 1, state: "after" };
  for (const w of windows) {
    const from = hm(w.from) ?? 0;
    const to = hm(w.to) ?? 0;
    if (now >= from && now < to) return { key: w.key, frac: to > from ? (now - from) / (to - from) : 0, state: "in" };
  }
  return null;
}

/** Minutes until the bell (9:30 NY) when it is still ahead, else null. */
export function minutesToOpen(windows: DayWindow[], now: number): number | null {
  const open = windows.find((w) => w.key === "open");
  const from = hm(open?.from ?? "09:30") ?? 570;
  return now < from ? from - now : null;
}

/* ── checklist grade · size ─────────────────────────────────────────────── */

export type Grade = "A" | "B" | "C";

/** All items = A, all but one = B, otherwise C («пропусти»). A one-item list: ticked = A, else C. */
export function gradeOf(checked: number, total: number): Grade | null {
  if (total <= 0) return null;
  if (checked >= total) return "A";
  if (total > 1 && checked === total - 1) return "B";
  return "C";
}

/** Share of 1R the grade trades with (desk rule from 0.1: A = full 1R, B = 0.5R, C = no trade). */
export const GRADE_RISK: Record<Grade, number> = { A: 1, B: 0.5, C: 0 };

/** "0,25" / "0.25" / "$0.25" → 0.25; empty or not a positive number → null. */
export function parseStop(v: string): number | null {
  const n = Number(v.replace(/[$\s]/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Shares for a risk in $ and a stop distance in $ per share, rounded down; null when either is missing. */
export function sharesFor(riskUsd: number | null | undefined, stopPerShare: number | null | undefined): number | null {
  if (riskUsd == null || stopPerShare == null || !(riskUsd > 0) || !(stopPerShare > 0)) return null;
  return Math.floor(riskUsd / stopPerShare + 1e-9);
}

/* ── my edge ────────────────────────────────────────────────────────────── */

const VERDICT_RANK: Record<MyEdge["verdict"], number> = { best: 0, good: 1, new: 2, careful: 3 };

/** Is it a setup one trades (not the 0.1 morning routine card)? */
export const isTradeable = (s: TodaySetup) => s.schema !== "routine" && s.window !== "premarket";

/** Best first: verdict, then average R, then the number of trades; ties by code. */
export function byEdge(a: TodaySetup, b: TodaySetup): number {
  const ra = VERDICT_RANK[a.myEdge?.verdict ?? "new"];
  const rb = VERDICT_RANK[b.myEdge?.verdict ?? "new"];
  if (ra !== rb) return ra - rb;
  const ar = a.myEdge?.avgR ?? 0;
  const br = b.myEdge?.avgR ?? 0;
  if (ar !== br) return br - ar;
  const at = a.myEdge?.trades ?? 0;
  const bt = b.myEdge?.trades ?? 0;
  if (at !== bt) return bt - at;
  return (a.code ?? a.name).localeCompare(b.code ?? b.name, "en", { numeric: true });
}

export type EdgeSummary = { strong: TodaySetup[]; careful: TodaySetup[]; fresh: number; traded: number };

/** «Где у тебя преимущество»: up to 3 strongest (best / good) among the setups open for the trader's level (a locked
 * setup is not something to lean on today, whatever the history), up to 2 to be careful with, how many are new. */
export function edgeSummary(setups: TodaySetup[]): EdgeSummary {
  const tradeable = setups.filter(isTradeable);
  const strong = tradeable
    .filter((s) => !s.locked && (s.myEdge?.verdict === "best" || s.myEdge?.verdict === "good"))
    .sort(byEdge)
    .slice(0, 3);
  const careful = tradeable
    .filter((s) => s.myEdge?.verdict === "careful")
    .sort((a, b) => (a.myEdge?.avgR ?? 0) - (b.myEdge?.avgR ?? 0))
    .slice(0, 2);
  const fresh = tradeable.filter((s) => !s.myEdge || s.myEdge.verdict === "new").length;
  const traded = tradeable.reduce((n, s) => n + (s.myEdge?.trades ?? 0), 0);
  return { strong, careful, fresh, traded };
}

/* ── picks ──────────────────────────────────────────────────────────────── */

/**
 * The first window still ahead (or running) that has setups the trader may trade — what «Сегодня торгую» is
 * prefilled from in the morning (the open, unless the open is already over).
 */
export function firstTradingWindow(today: Pick<PlaybookToday, "windows" | "setups">, now: number): DayWindowKey | null {
  const byId = new Map(today.setups.map((s) => [s.id, s]));
  for (const w of today.windows) {
    if ((hm(w.to) ?? 0) <= now) continue;
    if (w.setupIds.some((id) => { const s = byId.get(id); return !!s && !s.locked && isTradeable(s); })) return w.key;
  }
  return null;
}

/**
 * Prefill: the trader's best unlocked setups — first the ones with an edge (best / good) in the first window, then those
 * with an edge later in the day, then new ones of the first window; never «осторожно», locked or the routine card. Max 3.
 */
export function suggestPicks(today: Pick<PlaybookToday, "windows" | "setups">, now: number): number[] {
  const key = firstTradingWindow(today, now);
  if (!key) return [];
  const first = new Set(today.windows.find((w) => w.key === key)?.setupIds ?? []);
  const ahead = new Set(today.windows.filter((w) => (hm(w.to) ?? 0) > now).flatMap((w) => w.setupIds));
  const ok = today.setups.filter((s) => !s.locked && isTradeable(s) && ahead.has(s.id) && s.myEdge?.verdict !== "careful");
  const strong = (s: TodaySetup) => s.myEdge?.verdict === "best" || s.myEdge?.verdict === "good";
  const ranked = [
    ...ok.filter((s) => first.has(s.id) && strong(s)).sort(byEdge),
    ...ok.filter((s) => !first.has(s.id) && strong(s)).sort(byEdge),
    ...ok.filter((s) => first.has(s.id) && !strong(s)).sort(byEdge),
  ];
  return ranked.slice(0, MAX_PICKS).map((s) => s.id);
}

/** Toggle one id in the picks (max 3: a fourth is refused → the same list comes back). */
export function togglePick(picks: number[], id: number): number[] {
  if (picks.includes(id)) return picks.filter((x) => x !== id);
  return picks.length >= MAX_PICKS ? picks : [...picks, id];
}

export const samePicks = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Setups of a window in the order the landing shows them: unlocked by edge, then the locked ones. */
export function windowSetups(today: Pick<PlaybookToday, "setups">, w: DayWindow): TodaySetup[] {
  const byId = new Map(today.setups.map((s) => [s.id, s]));
  const list = w.setupIds.map((id) => byId.get(id)).filter((s): s is TodaySetup => !!s);
  return [...list.filter((s) => !s.locked).sort(byEdge), ...list.filter((s) => s.locked)];
}

/** Search in the quick sheet: code («1.3»), name, schema key; «orb» finds ORB. */
export function matchSetup(s: TodaySetup, q: string): boolean {
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = `${s.code ?? ""} ${s.name} ${s.schema ?? ""} ${s.folder ?? ""}`.toLowerCase().replace(/_/g, " ");
  return terms.every((t) => hay.includes(t));
}

/* ── «Мой план на сегодня» ──────────────────────────────────────────────── */

/** The plan strip: today's own contract from the personal plan (GET /api/game-plan/my doc) — daily stop, max trades,
 * the rule of the day (prefilled from the morning focus until the trader picks one, like the dashboard contract line). */
export type PlanFacts = { maxLossUsd: number | null; maxTrades: number | null; rule: string | null; ruleFromFocus: boolean };

export function planFacts(
  res: { plan?: { doc?: Record<string, unknown> | null } | null } | null | undefined,
  focus: { mistake: string | null; source: string } | null | undefined,
): PlanFacts {
  const doc = res?.plan?.doc ?? null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
  const own = doc?.ownRule;
  const saved = typeof own === "string" && own ? own : own === null ? null : undefined;
  const fromFocus = saved === undefined && !!focus?.mistake && focus.source !== "none";
  return {
    maxLossUsd: n(doc?.maxLossUsd),
    maxTrades: n(doc?.maxTrades),
    rule: saved ?? (fromFocus ? focus?.mistake ?? null : null),
    ruleFromFocus: fromFocus,
  };
}

/** Prefill tiles of the empty plan: the suggestion first, then anything starred in the list (no duplicates). */
export function pickCandidates(suggestion: number[], draft: number[]): number[] {
  return [...new Set([...suggestion, ...draft])];
}
