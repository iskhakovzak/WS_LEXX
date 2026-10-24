/**
 * The structured AI review (trade or day) — one JSON shape for the model (output_config.format json_schema) and the
 * validator every answer passes before it is stored or shown (zod; an answer that does not fit is never shown).
 *
 *   verdict      grade A–F, a one-line headline, whether the trade / day followed the plan (unknown when unsure)
 *   wentWell     0–4 points; each with evidence (a fill, a minute, a stat, a rule, an edge-map slice) and its basis:
 *   wentWrong      fact = read off the data; hypothesis = an interpretation the data does not prove
 *   edge         the trader's own edge map, quoted with its interval (null when the map has nothing relevant)
 *   tomorrow     the one rule / focus for tomorrow as an implementation intention: «if <cue>, then <action>»
 *   whatIf       a rule to test in the «What if» simulator (a closed list of rule types) and why — or null
 *   confidence   low / medium / high, and the data gaps that limit the review
 * REVIEW_VERSION is part of the cache key: bump it whenever the schema, the prompt or the inputs change meaning.
 */
import { z } from "zod";

export const REVIEW_VERSION = 2;

export const GRADES = ["A", "B", "C", "D", "F"] as const;
export const EVIDENCE_KINDS = ["fill", "minute", "stat", "rule", "edge", "chart"] as const;
/** «What if» rule types a review may propose (a subset of the simulator's rules with simple parameters). */
export const WHATIF_TYPES = [
  "maxTradesPerDay", "stopAfterLosses", "afterLoss", "afterWin", "noReentry", "noReentryAfterLoss", "timeWindow",
  "dailyLossLimit", "capLoss", "minHold", "requireStop", "maxSizeRel", "profitGiveback", "dailyProfitTarget", "excludeSetups", "excludeTickers",
] as const;

const text = (max: number) => z.string().trim().min(1).max(max);

const EvidenceSchema = z.object({
  kind: z.enum(EVIDENCE_KINDS),
  /** What the evidence is, short: «fill 3 · 10:41:05 · add 200 @ 12.34», «09:47», «edge: 15:00+ −$40/day [−$70; −$12]». */
  label: text(140),
  /** ET wall-clock minute it points at (HH:MM) or null. */
  at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  /** 1-based fill number of the trade (trade reviews) or trade number in the day (day reviews), or null. */
  ref: z.number().int().min(1).max(500).nullable(),
});

const PointSchema = z.object({
  text: text(400),
  basis: z.enum(["fact", "hypothesis"]),
  evidence: z.array(EvidenceSchema).max(4),
});

const WhatIfSchema = z.object({
  type: z.enum(WHATIF_TYPES),
  /** Count parameter (trades, losses) or null. */
  n: z.number().int().min(1).max(50).nullable(),
  /** Minutes parameter (pause after a loss / win, re-entry window) or null. */
  minutes: z.number().int().min(1).max(390).nullable(),
  /** Dollar parameter (loss limit, cap, profit target, giveback peak) or null. */
  usd: z.number().positive().max(1_000_000).nullable(),
  /** Percent parameter (giveback share) or null. */
  pct: z.number().positive().max(100).nullable(),
  /** HH:MM window bounds (timeWindow) or null. */
  from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  /** Seconds (minHold) or size multiple (maxSizeRel) or null. */
  value: z.number().positive().max(100_000).nullable(),
  /** Setup names / tickers to exclude, else []. */
  items: z.array(text(60)).max(5),
  why: text(300),
});

export const ReviewSchema = z.object({
  verdict: z.object({
    grade: z.enum(GRADES),
    headline: text(200),
    followedPlan: z.enum(["yes", "partly", "no", "unknown"]),
  }),
  wentWell: z.array(PointSchema).max(4),
  wentWrong: z.array(PointSchema).max(4),
  edge: z.object({ text: text(300), interval: z.string().trim().max(80).nullable() }).nullable(),
  tomorrow: z.object({ if: text(200), then: text(200) }),
  whatIf: WhatIfSchema.nullable(),
  confidence: z.enum(["low", "medium", "high"]),
  dataGaps: z.array(text(160)).max(5),
});

export type Review = z.infer<typeof ReviewSchema>;
export type WhatIfIdea = NonNullable<Review["whatIf"]>;

// ─── JSON Schema for output_config.format (kept in step with ReviewSchema; a test checks both accept the same sample) ─

const str = (description: string) => ({ type: "string", description });
const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

const evidenceJson = obj({
  kind: { type: "string", enum: [...EVIDENCE_KINDS] },
  label: str("Short pointer to the data, e.g. 'fill 3 · 10:41:05 · add 200 @ 12.34' or 'edge: entries after 15:00'."),
  at: nullable(str("ET minute HH:MM the evidence points at")),
  ref: nullable({ type: "integer", description: "1-based fill number (trade) or trade number in the day (day)" }),
});
const pointJson = obj({
  text: str("One concrete sentence."),
  basis: { type: "string", enum: ["fact", "hypothesis"] },
  evidence: { type: "array", items: evidenceJson },
});

export const REVIEW_JSON_SCHEMA: Record<string, unknown> = obj({
  verdict: obj({
    grade: { type: "string", enum: [...GRADES] },
    headline: str("One line: the verdict in plain trader language."),
    followedPlan: { type: "string", enum: ["yes", "partly", "no", "unknown"] },
  }),
  wentWell: { type: "array", items: pointJson },
  wentWrong: { type: "array", items: pointJson },
  edge: nullable(obj({ text: str("What the trader's own edge map says about this situation."), interval: nullable(str("The interval as given, e.g. '$12–$70 per day (80%)'")) })),
  tomorrow: obj({ if: str("The cue (situation) — when …"), then: str("The concrete action — I will …") }),
  whatIf: nullable(obj({
    type: { type: "string", enum: [...WHATIF_TYPES] },
    n: nullable({ type: "integer" }),
    minutes: nullable({ type: "integer" }),
    usd: nullable({ type: "number" }),
    pct: nullable({ type: "number" }),
    from: nullable(str("HH:MM")),
    to: nullable(str("HH:MM")),
    value: nullable({ type: "number" }),
    items: { type: "array", items: { type: "string" } },
    why: str("Why this rule is worth testing, in one sentence."),
  })),
  confidence: { type: "string", enum: ["low", "medium", "high"] },
  dataGaps: { type: "array", items: { type: "string" } },
});

/** Pull the JSON object out of a model answer (structured output = the whole text; fallback: the first {...}). */
export function extractJson(raw: string): unknown {
  const s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(s); } catch { /* fall through */ }
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/** Validate a model answer. Lists over their caps are trimmed (the model sometimes gives a 5th point), not rejected. */
export function parseReview(raw: string): { ok: true; review: Review } | { ok: false; issues: string[] } {
  const data = extractJson(raw);
  if (!data || typeof data !== "object") return { ok: false, issues: ["not a JSON object"] };
  const d = data as Record<string, unknown>;
  const trim = (v: unknown, n: number) => (Array.isArray(v) ? v.slice(0, n) : v);
  const pts = (v: unknown) => (Array.isArray(v) ? v.slice(0, 4).map((p) => (p && typeof p === "object" ? { ...p, evidence: trim((p as Record<string, unknown>).evidence, 4) } : p)) : v);
  const fixed = { ...d, wentWell: pts(d.wentWell), wentWrong: pts(d.wentWrong), dataGaps: trim(d.dataGaps, 5) };
  const r = ReviewSchema.safeParse(fixed);
  return r.success ? { ok: true, review: r.data } : { ok: false, issues: r.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`) };
}

/** The simulator rule a what-if idea maps to (the shape of the web's What-if `Rule`), or null when parameters are missing. */
export function whatIfRule(w: WhatIfIdea): Record<string, unknown> | null {
  switch (w.type) {
    case "maxTradesPerDay": case "stopAfterLosses": return w.n ? { type: w.type, n: w.n } : null;
    case "afterLoss": case "afterWin": case "noReentryAfterLoss": return w.minutes ? { type: w.type, minutes: w.minutes } : null;
    case "noReentry": case "requireStop": return { type: w.type };
    case "timeWindow": return w.from || w.to ? { type: w.type, from: w.from, to: w.to } : null;
    case "dailyLossLimit": case "capLoss": case "dailyProfitTarget": return w.usd ? { type: w.type, usd: w.usd } : null;
    case "minHold": return w.value ? { type: w.type, seconds: Math.round(w.value) } : null;
    case "maxSizeRel": return w.value ? { type: w.type, x: w.value } : null;
    case "profitGiveback": return w.usd && w.pct ? { type: w.type, peak: w.usd, pct: w.pct } : null;
    case "excludeSetups": return w.items.length ? { type: w.type, setups: w.items } : null;
    case "excludeTickers": return w.items.length ? { type: w.type, tickers: w.items.map((t) => t.toUpperCase()) } : null;
  }
}
