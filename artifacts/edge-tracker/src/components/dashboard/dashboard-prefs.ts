// Dashboard layout prefs (order / hidden blocks / scope / equity window), per viewer in localStorage. Split out of
// use-dashboard.ts.
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_ORDER, SECTION_META, type EquityMetric, type EquityPeriod, type Scope, type SectionId } from "./use-dashboard";

export type DashboardPrefs = {
  order: SectionId[];
  hidden: SectionId[];
  scope: Scope;
  /** The scope was switched by hand; otherwise it follows the default («Мои» for everyone, staff included). */
  scopePicked?: boolean;
  period: EquityPeriod;
  metric: EquityMetric;
};

const PREFS_KEY = "ws_lexx_dashboard_prefs_v5";
/** Previous layout (bundled «ritual» / «market» blocks): migrated once — scope/period/metric/order kept, new defaults hidden. */
const LEGACY_PREFS_KEY = "ws_lexx_dashboard_prefs_v4";
const LEGACY_SPLIT: Record<string, SectionId[]> = { ritual: ["checkin", "brief", "quote"], market: ["sectors", "macro", "dna"] };

/** Sensible defaults: the cockpit on top, extras off (traders keep the morning check-in); staff see the desk instead of streaks. */
function defaultPrefs(scope: Scope): DashboardPrefs {
  const extras = DEFAULT_ORDER.filter((id) => SECTION_META[id].extra && (scope === "team" || id !== "checkin"));
  return {
    order: DEFAULT_ORDER,
    hidden: scope === "team" ? ["streaks", ...extras] : extras,
    scope,
    period: "week",
    metric: "pnl",
  };
}

const PERIODS: EquityPeriod[] = ["week", "30d", "90d", "ytd", "all"];

function expandLegacy(ids: unknown[]): string[] {
  return ids.flatMap((x) => (typeof x === "string" && LEGACY_SPLIT[x] ? LEGACY_SPLIT[x] : [x as string]));
}

export function sanitizeDashboardPrefs(raw: unknown, fallbackScope: Scope, legacy = false): DashboardPrefs {
  const base = defaultPrefs(fallbackScope);
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<DashboardPrefs>;
  const known = new Set<SectionId>(DEFAULT_ORDER);
  const rawOrder = Array.isArray(r.order) ? (legacy ? expandLegacy(r.order) : r.order) : [];
  const order = rawOrder.filter((x): x is SectionId => known.has(x as SectionId));
  for (const id of DEFAULT_ORDER) if (!order.includes(id)) order.push(id);
  const rawHidden = Array.isArray(r.hidden) ? (legacy ? expandLegacy(r.hidden) : r.hidden) : null;
  const userHidden = rawHidden ? rawHidden.filter((x): x is SectionId => known.has(x as SectionId)) : base.hidden;
  // Legacy layouts were saved with everything on; apply the decluttered defaults on top of what the user hid.
  const hidden = legacy ? Array.from(new Set([...base.hidden, ...userHidden])) : userHidden;
  // Staff = traders + extras (owner rule 2026-10-21): a «Команда» saved as the old staff default (never picked by
  // hand) becomes «Мои» once, with the trader blocks it had hidden (streaks, the morning check-in) back on.
  const picked = r.scopePicked === true && (r.scope === "team" || r.scope === "me");
  const migrate = !picked && r.scope === "team" && fallbackScope === "me";
  return {
    order: Array.from(new Set(order)),
    hidden: migrate ? hidden.filter((id) => id !== "streaks" && id !== "checkin") : hidden,
    scope: picked ? (r.scope as Scope) : fallbackScope,
    scopePicked: picked,
    period: PERIODS.includes(r.period as EquityPeriod) ? (r.period as EquityPeriod) : base.period,
    metric: r.metric === "r" ? "r" : "pnl",
  };
}

function loadPrefs(key: string, legacyKey: string, fallbackScope: Scope): DashboardPrefs {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return sanitizeDashboardPrefs(JSON.parse(raw), fallbackScope);
    const old = localStorage.getItem(legacyKey);
    return sanitizeDashboardPrefs(old ? JSON.parse(old) : null, fallbackScope, true);
  } catch {
    return sanitizeDashboardPrefs(null, fallbackScope);
  }
}

/** Prefs are keyed by the signed-in identity, so two people on one browser do not share a layout. */
export function useDashboardPrefs(fallbackScope: Scope, viewerKey: string | null) {
  const key = `${PREFS_KEY}:${viewerKey ?? "guest"}`;
  const legacyKey = `${LEGACY_PREFS_KEY}:${viewerKey ?? "guest"}`;
  const [prefs, setPrefs] = useState<DashboardPrefs>(() => loadPrefs(key, legacyKey, fallbackScope));

  // Identity changed (login/logout) → reload that viewer's prefs.
  useEffect(() => {
    setPrefs(loadPrefs(key, legacyKey, fallbackScope));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(prefs));
    } catch {
      /* storage unavailable — prefs live for this session only */
    }
  }, [prefs, key]);

  const update = useCallback((patch: Partial<DashboardPrefs>) => setPrefs((p) => ({ ...p, ...patch })), []);
  const reset = useCallback(() => setPrefs(defaultPrefs(fallbackScope)), [fallbackScope]);
  return { prefs, update, reset };
}
