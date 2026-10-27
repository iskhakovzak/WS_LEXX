/**
 * The one scope of the ANALYTICS group (design audit wave 3): /stats, /analytics, /behavior, /what-if and /benchmark
 * read and write the same period · person · unit, so a choice made on one page is there on the next one opened from
 * the sidebar.
 *
 *   period  the vocabulary without «Сегодня» (a single day is /day-report's job): week · month · quarter · year · all,
 *           plus «Период…» (custom from / to). Default «Квартал» (90 days — the old default of the group).
 *   person  "" = the viewer's own book (the default), TEAM = «Вся команда», or a name. Each page keeps its own rules
 *           (a member only ever sees the own book; «Вся команда» is not restored from storage on /stats, /analytics).
 *   unit    "r" | "usd" where a page has one (null = the page's automatic choice).
 *
 * Load order per field: the URL (`period` `from` `to` `trader` `unit`; legacy `p`, `7d / 30d / 90d / ytd` via
 * normalizePeriod, `trader=__all__`) → the shared key `ws.analyticsScope.v1` → the page's old prefs key (read once, so
 * saved choices survive) → the default. Every change: history.replaceState (the page's other params stay) + the
 * shared key (only the fields the page manages are rewritten).
 * A single-page URL period without sharing lives in ./use-period-param.
 */
import * as React from "react";
import {
  normalizePeriod, parseDayRange, periodDays, periodWindow, prevDayRange, type DayRange, type PeriodPreset,
} from "@/lib/period-range";
import { nyDate } from "@/lib/trading-date";

export const ANALYTICS_PRESETS = ["week", "month", "quarter", "year", "all"] as const satisfies readonly PeriodPreset[];
export type AnalyticsPreset = (typeof ANALYTICS_PRESETS)[number];
export type AnalyticsPeriod = AnalyticsPreset | "custom";
export type AnalyticsUnit = "r" | "usd";
export const DEFAULT_ANALYTICS_PERIOD: AnalyticsPreset = "quarter";
export const ANALYTICS_SCOPE_KEY = "ws.analyticsScope.v1";
/** `?trader=all` = «Вся команда» in a link (the value /stats always used); `__all__` / `__team__` are read too. */
export const TEAM_PARAM = "all";
/** The staff picker's «Вся команда» value (components/people/staff-scope TEAM; hooks may not import a feature). */
const TEAM = "__team__";

/** A page's old prefs, already in this shape: trader "" (own) / TEAM / a name. */
export type ScopeSource = { period?: unknown; from?: unknown; to?: unknown; trader?: unknown; unit?: unknown };

export type ScopeState = { period: AnalyticsPeriod; custom: DayRange | null; trader: string; unit: AnalyticsUnit | null };

export type ScopeReadOptions = {
  /** «Всё» restored from storage (false on /stats, /analytics: the whole book loads on demand only, DEV-01). */
  restoreAll?: boolean;
  /** «Вся команда» restored from storage (false on /stats, /analytics). */
  restoreTeam?: boolean;
  /** Old URL keys of the period (what-if `p`). */
  legacyPeriodParams?: readonly string[];
};

const isPreset = (v: string): v is AnalyticsPreset => (ANALYTICS_PRESETS as readonly string[]).includes(v);

function teamOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s === TEAM_PARAM || s === "__all__" || s === TEAM) return TEAM;
  return s;
}

function periodOf(src: ScopeSource | null, fromStorage: boolean, o: ScopeReadOptions): { period: AnalyticsPeriod; custom: DayRange | null } | null {
  if (!src || typeof src.period !== "string" || !src.period) return null;
  const p = normalizePeriod(src.period, "today");
  const custom = parseDayRange(src.from, src.to);
  if (p === "custom") return custom ? { period: "custom", custom } : null;
  if (!isPreset(p)) return null; // «Сегодня» / unknown: not offered here
  if (p === "all" && fromStorage && o.restoreAll === false) return null;
  return { period: p, custom };
}

function traderOf(src: ScopeSource | null, fromStorage: boolean, o: ScopeReadOptions): string | null {
  if (!src || typeof src.trader !== "string") return null;
  const v = teamOf(src.trader);
  if (v == null) return null;
  if (v === TEAM && fromStorage && o.restoreTeam === false) return "";
  return v;
}

const unitOf = (src: ScopeSource | null): AnalyticsUnit | null => (src?.unit === "r" || src?.unit === "usd" ? src.unit : null);

/** The scope a page opens with (pure: URL search, the shared key, the page's old prefs). */
export function readAnalyticsScope(search: string, shared: ScopeSource | null, legacy: ScopeSource | null, o: ScopeReadOptions = {}): ScopeState {
  const q = new URLSearchParams(search);
  const urlPeriod = q.get("period") ?? (o.legacyPeriodParams ?? []).map((k) => q.get(k)).find((v) => !!v) ?? null;
  const url: ScopeSource = { period: urlPeriod, from: q.get("from"), to: q.get("to"), trader: q.get("trader"), unit: q.get("unit") };
  const sources: [ScopeSource | null, boolean][] = [[url, false], [shared, true], [legacy, true]];
  let period: { period: AnalyticsPeriod; custom: DayRange | null } | null = null;
  let trader: string | null = null;
  let unit: AnalyticsUnit | null = null;
  for (const [src, stored] of sources) {
    period ??= periodOf(src, stored, o);
    trader ??= traderOf(src, stored, o);
    unit ??= unitOf(src);
  }
  // A preset keeps the last custom range (so «Период…» reopens on it): the first valid one of any source.
  const custom = period?.custom ?? sources.map(([s]) => (s ? parseDayRange(s.from, s.to) : null)).find(Boolean) ?? null;
  return { period: period?.period ?? DEFAULT_ANALYTICS_PERIOD, custom, trader: trader ?? "", unit };
}

function readShared(): ScopeSource | null {
  try {
    const raw = localStorage.getItem(ANALYTICS_SCOPE_KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" ? (v as ScopeSource) : null;
  } catch {
    return null;
  }
}

function writeShared(patch: ScopeSource) {
  try {
    localStorage.setItem(ANALYTICS_SCOPE_KEY, JSON.stringify({ ...(readShared() ?? {}), ...patch }));
  } catch {
    /* private mode — the scope just won't follow */
  }
}

export type AnalyticsScopeOptions = ScopeReadOptions & {
  /** The page's old prefs, read once when the shared key has nothing for a field. */
  legacy?: () => ScopeSource | null;
  /** The page shows a person (staff): `trader` goes into the URL and the shared key. */
  person?: boolean;
  /** The page has a unit R / $: `unit` goes into the URL and the shared key. */
  unit?: boolean;
};

export type AnalyticsScope = ScopeState & {
  today: string;
  /** The period's window (null = «Всё»). */
  window: DayRange | null;
  /** The equally long window right before (the comparison), null for «Всё». */
  prev: DayRange | null;
  /** Days of the window (null = «Всё»): endpoints that take `days=N`. */
  days: number | null;
  setPreset: (p: AnalyticsPreset) => void;
  setCustom: (r: DayRange) => void;
  /** "" = own book, TEAM, or a name. */
  setTrader: (v: string) => void;
  setUnit: (u: AnalyticsUnit) => void;
};

export function useAnalyticsScope(o: AnalyticsScopeOptions = {}): AnalyticsScope {
  const today = nyDate();
  const opts = React.useRef(o);
  opts.current = o;
  const [state, setState] = React.useState<ScopeState>(() => {
    const shared = readShared();
    let legacy: ScopeSource | null = null;
    try { legacy = o.legacy?.() ?? null; } catch { legacy = null; }
    const s = readAnalyticsScope(typeof window === "undefined" ? "" : window.location.search, shared, legacy, o);
    // Seed the shared key from the page's old prefs once, so the next page of the group opens on the same scope.
    if (!shared && legacy) writeShared({ period: s.period, ...(s.custom ?? {}), trader: s.trader === TEAM ? "" : s.trader, unit: s.unit });
    return s;
  });

  const commit = React.useCallback((next: ScopeState) => {
    setState(next);
    const { person, unit, legacyPeriodParams } = opts.current;
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      const sp = url.searchParams;
      sp.set("period", next.period);
      for (const k of legacyPeriodParams ?? []) sp.delete(k);
      if (next.period === "custom" && next.custom) { sp.set("from", next.custom.from); sp.set("to", next.custom.to); } else { sp.delete("from"); sp.delete("to"); }
      if (person) {
        if (next.trader) sp.set("trader", next.trader === TEAM ? TEAM_PARAM : next.trader);
        else sp.delete("trader");
      }
      if (unit) { if (next.unit) sp.set("unit", next.unit); else sp.delete("unit"); }
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    writeShared({
      period: next.period,
      ...(next.custom ?? {}),
      ...(person ? { trader: next.trader } : {}),
      ...(unit ? { unit: next.unit } : {}),
    });
  }, []);

  const ref = React.useRef(state);
  ref.current = state;
  const setPreset = React.useCallback((p: AnalyticsPreset) => commit({ ...ref.current, period: p }), [commit]);
  const setCustom = React.useCallback((r: DayRange) => commit({ ...ref.current, period: "custom", custom: r }), [commit]);
  const setTrader = React.useCallback((v: string) => commit({ ...ref.current, trader: v }), [commit]);
  const setUnit = React.useCallback((u: AnalyticsUnit) => commit({ ...ref.current, unit: u }), [commit]);

  const window_ = React.useMemo(() => periodWindow(state.period, today, state.custom), [state.period, state.custom, today]);
  const prev = React.useMemo(() => (window_ ? prevDayRange(window_) : null), [window_]);
  return {
    ...state,
    today,
    window: window_,
    prev,
    days: periodDays(state.period, state.custom),
    setPreset,
    setCustom,
    setTrader,
    setUnit,
  };
}
