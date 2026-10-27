/**
 * «Рекомендации офису» — desk-level recommendations (types shared by the generators, the store and the route).
 *
 * Every generator is pure (synthetic fixtures in __tests__/officeRecs.test.ts) and returns at most a couple of
 * recommendations, or none when the sample is small or nothing passes its gates. Text is never built here: the web
 * renders the title / why line from `kind` + `params` in the reader's language (i18n ns officeStats `recs.*`).
 *
 * Money ($) and trader names are added for everyone here and stripped per viewer in redact.ts:
 *   admin (partner)  — $ and every name;
 *   curator          — no $ (the office page shows them % only), names only of the traders their scope may read;
 *   trader           — anonymised desk aggregates only; staff-only kinds (curator load, readiness) are dropped.
 */

export const REC_KINDS = ["leak", "rule", "fees", "crowding", "practice", "attention", "readiness", "regime", "juniorCost"] as const;
export type RecKind = (typeof REC_KINDS)[number];

/** desk = any member may see the (anonymised) aggregate; staff = curators and partners only. */
export type RecAudience = "desk" | "staff";

export type Interval = { mean: number; lo: number; hi: number };

/** A link to an existing page / sheet (the web maps `kind` to a label). */
export type RecAction = { kind: "whatif" | "rules" | "curator" | "academy" | "risk" | "benchmark" | "myReview" | "trades" | "office"; href: string };

export type OfficeRec = {
  /** Stable across runs: `${kind}:${key}` (the «скрыть на неделю» key). */
  id: string;
  kind: RecKind;
  audience: RecAudience;
  /** Sort order (higher first): roughly the $ per desk day at stake, scaled per kind. */
  priority: number;
  /** 1–3 ticks: how sure the finding is (gates and multiple testing passed with room to spare = 3). */
  confidence: 1 | 2 | 3;
  /** Text parameters (numbers already rounded; no $ amounts — those live in `money`). */
  params: Record<string, string | number | null>;
  /** $ effect with its 80% interval (partners only; null for everyone else). `per` says per what. */
  money: (Interval & { per: "trade" | "day" | "traderDay" }) | null;
  /** Unit-free effect (bps of notional per trade, or a share) with its 80% interval — what non-partners see. */
  rel: (Interval & { unit: "bps" | "share" }) | null;
  /** Who it affects: the count always, names only when the viewer may see them. */
  affected: { count: number; names: string[] };
  action: RecAction | null;
  secondary: RecAction | null;
  /** What the finding rests on. */
  basis: { trades: number; days: number; traders: number; from: string; to: string; q: number | null };
};

/** A recommendation as a generator returns it, before the viewer's redaction. */
export type RawRec = OfficeRec;

/** Desk window of the trade-based generators (trading days with any desk trade). */
export const REC_WINDOW_DAYS = 120;

/**
 * α of the Benjamini–Hochberg step across the slices / rules a generator tried. Stricter than the per-trader edge map
 * (0.10): a desk-wide recommendation asks everyone to change something.
 */
export const REC_Q_MAX = 0.05;

export const round = (v: number, d = 2): number => {
  const k = 10 ** d;
  return Math.round(v * k) / k;
};

export function median(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Ticks from the BH q value and the persistence (or another «room to spare» flag). */
export function ticksOf(q: number, strong: boolean): 1 | 2 | 3 {
  if (q <= 0.01 && strong) return 3;
  if (q <= 0.05) return 2;
  return 1;
}
