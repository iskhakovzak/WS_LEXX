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

/** v6 = the composed dashboard (2026-10-25: sections, «Ваш edge» bento, no «Сегодня» tile). */
const PREFS_KEY = "ws_lexx_dashboard_prefs_v6";
/**
 * Earlier layouts, migrated once into the new default: scope / period / metric are kept, and so are the opt-in extras
 * the viewer had switched on (v5); the order and the shown / hidden main blocks and tiles start from the new default,
 * ids that no longer exist are dropped. v4 bundled extras into «ritual» / «market» and saved everything on.
 */
const LEGACY_KEYS = [
  { key: "ws_lexx_dashboard_prefs_v5", keepExtras: true },
  { key: "ws_lexx_dashboard_prefs_v4", keepExtras: false },
] as const;

/** Own-trade insight tiles: shown on «Мои» only, hidden in a «Команда» default. */
const OWN_CARDS: SectionId[] = DEFAULT_ORDER.filter((id) => SECTION_META[id].group === "edge");
/** Off by default but offered in «Настроить» («Ваш edge»). */
const QUIET_TILES: SectionId[] = ["weekdays"];

/** Sensible defaults: the composed dashboard, extras off (traders keep the morning check-in); «Команда» without own tiles. */
export function defaultPrefs(scope: Scope): DashboardPrefs {
  const extras = DEFAULT_ORDER.filter((id) => SECTION_META[id].extra && (scope === "team" || id !== "checkin"));
  return {
    order: DEFAULT_ORDER,
    hidden: scope === "team" ? [...OWN_CARDS, ...extras] : [...QUIET_TILES, ...extras],
    scope,
    period: "week",
    metric: "pnl",
  };
}

const PERIODS: EquityPeriod[] = ["week", "30d", "90d", "ytd", "all"];
const known = new Set<SectionId>(DEFAULT_ORDER);
const ids = (v: unknown): SectionId[] => (Array.isArray(v) ? v.filter((x): x is SectionId => known.has(x as SectionId)) : []);

/** The scope fields: a scope switched by hand is kept; an auto-saved staff «Команда» becomes «Мои» (owner rule 2026-10-21). */
function scopeOf(r: Partial<DashboardPrefs>, fallbackScope: Scope) {
  const picked = r.scopePicked === true && (r.scope === "team" || r.scope === "me");
  return { scope: picked ? (r.scope as Scope) : fallbackScope, scopePicked: picked };
}

function common(r: Partial<DashboardPrefs>, fallbackScope: Scope) {
  const base = defaultPrefs(fallbackScope);
  return {
    ...scopeOf(r, fallbackScope),
    period: PERIODS.includes(r.period as EquityPeriod) ? (r.period as EquityPeriod) : base.period,
    metric: r.metric === "r" ? ("r" as const) : ("pnl" as const),
  };
}

export function sanitizeDashboardPrefs(raw: unknown, fallbackScope: Scope): DashboardPrefs {
  if (!raw || typeof raw !== "object") return defaultPrefs(fallbackScope);
  const r = raw as Partial<DashboardPrefs>;
  const c = common(r, fallbackScope);
  const order = ids(r.order);
  for (const id of DEFAULT_ORDER) if (!order.includes(id)) order.push(id);
  const hidden = Array.isArray(r.hidden) ? ids(r.hidden) : defaultPrefs(c.scope).hidden;
  // An auto-saved staff «Команда» (never picked by hand) that became «Мои»: the own tiles it had hidden come back.
  const migrated = !c.scopePicked && r.scope === "team" && fallbackScope === "me";
  return {
    order: Array.from(new Set(order)),
    hidden: Array.from(new Set(migrated ? hidden.filter((id) => !OWN_CARDS.includes(id) && id !== "checkin") : hidden)),
    ...c,
  };
}

/** One-time move from an earlier layout: the new default + scope / period / metric (+ the extras switched on, v5). */
export function migrateDashboardPrefs(raw: unknown, fallbackScope: Scope, keepExtras: boolean): DashboardPrefs {
  if (!raw || typeof raw !== "object") return defaultPrefs(fallbackScope);
  const r = raw as Partial<DashboardPrefs>;
  const c = common(r, fallbackScope);
  const base = defaultPrefs(c.scope);
  const oldHidden = Array.isArray(r.hidden) ? new Set(r.hidden as unknown[]) : null;
  const shownExtras = keepExtras && oldHidden
    ? DEFAULT_ORDER.filter((id) => SECTION_META[id].extra && !oldHidden.has(id))
    : [];
  return { order: DEFAULT_ORDER, hidden: base.hidden.filter((id) => !shownExtras.includes(id)), ...c };
}

function loadPrefs(viewer: string, fallbackScope: Scope): DashboardPrefs {
  try {
    const raw = localStorage.getItem(`${PREFS_KEY}:${viewer}`);
    if (raw) return sanitizeDashboardPrefs(JSON.parse(raw), fallbackScope);
    for (const l of LEGACY_KEYS) {
      const old = localStorage.getItem(`${l.key}:${viewer}`);
      if (old) return migrateDashboardPrefs(JSON.parse(old), fallbackScope, l.keepExtras);
    }
  } catch {
    /* unreadable → defaults */
  }
  return defaultPrefs(fallbackScope);
}

/** Prefs are keyed by the signed-in identity, so two people on one browser do not share a layout. */
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
  // Reset = the new default layout; the scope the viewer is on and the curve's window / unit stay.
  const reset = useCallback(
    () => setPrefs((p) => ({ ...defaultPrefs(p.scope), scope: p.scope, scopePicked: p.scopePicked, period: p.period, metric: p.metric })),
    [],
  );
  return { prefs, update, reset };
}
