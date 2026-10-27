// Dashboard view prefs (scope «Мои / Команда», the curve's window and unit), per viewer on this device. The layout —
// which tiles, where, how big — moved to the account (./dashboard-layout, 2026-10-25); the v6 prefs still hold the
// old order / hidden lists it is migrated from, so they are only read here, never rewritten.
import { useCallback, useEffect, useState } from "react";
import { normalizePeriod } from "@/lib/period-range";
import type { EquityMetric, EquityPeriod, Scope } from "./use-dashboard";

export type DashboardPrefs = {
  scope: Scope;
  /** The scope was switched by hand; otherwise it follows the default («Мои» for everyone, staff included). */
  scopePicked?: boolean;
  period: EquityPeriod;
  metric: EquityMetric;
};

const PREFS_KEY = "ws_lexx_dashboard_view_v1";
/** Earlier prefs (order / hidden + these fields), newest first: the view fields are carried over once. */
const LEGACY_KEYS = ["ws_lexx_dashboard_prefs_v6", "ws_lexx_dashboard_prefs_v5", "ws_lexx_dashboard_prefs_v4"] as const;

export function defaultPrefs(scope: Scope): DashboardPrefs {
  return { scope, period: "week", metric: "pnl" };
}

const PERIODS: EquityPeriod[] = ["week", "month", "quarter", "year", "all"];

/** A saved window in the period vocabulary: older prefs held 7d / 30d / 90d / ytd (→ week / month / quarter / year). */
function periodOf(v: unknown): EquityPeriod {
  const p = normalizePeriod(v, "week");
  return (PERIODS as string[]).includes(p) ? (p as EquityPeriod) : "week";
}

/** A scope switched by hand is kept; an auto-saved staff «Команда» becomes «Мои» (owner rule 2026-10-21). */
export function sanitizeDashboardPrefs(raw: unknown, fallbackScope: Scope): DashboardPrefs {
  if (!raw || typeof raw !== "object") return defaultPrefs(fallbackScope);
  const r = raw as Partial<DashboardPrefs>;
  const picked = r.scopePicked === true && (r.scope === "team" || r.scope === "me");
  return {
    scope: picked ? (r.scope as Scope) : fallbackScope,
    scopePicked: picked,
    period: periodOf(r.period),
    metric: r.metric === "r" ? "r" : "pnl",
  };
}

function loadPrefs(viewer: string, fallbackScope: Scope): DashboardPrefs {
  try {
    for (const key of [PREFS_KEY, ...LEGACY_KEYS]) {
      const raw = localStorage.getItem(`${key}:${viewer}`);
      if (raw) return sanitizeDashboardPrefs(JSON.parse(raw), fallbackScope);
    }
  } catch {
    /* unreadable → defaults */
  }
  return defaultPrefs(fallbackScope);
}

/** Prefs are keyed by the signed-in identity, so two people on one browser do not share them. */
export function useDashboardPrefs(fallbackScope: Scope, viewerKey: string | null) {
  const viewer = viewerKey ?? "guest";
  const key = `${PREFS_KEY}:${viewer}`;
  const [prefs, setPrefs] = useState<DashboardPrefs>(() => loadPrefs(viewer, fallbackScope));

  // Identity changed (login/logout) → reload that viewer's prefs.
  useEffect(() => {
    setPrefs(loadPrefs(viewer, fallbackScope));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer]);

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(prefs));
    } catch {
      /* storage unavailable — prefs live for this session only */
    }
  }, [prefs, key]);

  const update = useCallback((patch: Partial<DashboardPrefs>) => setPrefs((p) => ({ ...p, ...patch })), []);
  return { prefs, update };
}
