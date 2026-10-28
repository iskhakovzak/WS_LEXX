/**
 * Setup checklists with scoring (pure; tests in __tests__/gates.test.ts). A playbook setup's checklist items
 * (playbook.checklist_items {id, text}) may carry a weight (1–5, default 1) and an auto-prefill code; the setup has a
 * threshold (playbook.checklist_threshold) — «second day: 5 factors, 4 required».
 *
 *   normItems(input)               the one validator of the items (write path + read path)
 *   prefillChecks(items, facts)    what the day's data already says: gap ≥ flow.autoGapPct, relative volume ≥
 *                                  flow.autoRvol, a strong catalyst mark, an analyst action on the ticker today
 *   scoreOf(items, checks, thr)    Σ weights of the ticked items, the max, the threshold (default: all of them) and passed
 *   suggestedRisk(oneR, s, k)      the plan's 1R × flow.checklistRiskFactor when the score is below the threshold
 *   bandOf(s)                      pass / near (one weight point short) / low / none — the stats bands
 */
export const AUTO_KINDS = ["gap", "rvol", "catalyst", "analyst"] as const;
export type AutoKind = (typeof AUTO_KINDS)[number];

export type ChecklistItem = { id: string; text: string; weight?: number; auto?: AutoKind | null };

const MAX_ITEMS = 40;

export function normItems(input: unknown): ChecklistItem[] | null {
  if (!Array.isArray(input)) return null;
  const out: ChecklistItem[] = [];
  for (const it of input) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const text = String(o.text ?? "").trim();
    const id = String(o.id ?? "").trim();
    if (!text || !id) continue;
    const w = Number(o.weight);
    const auto = (AUTO_KINDS as readonly string[]).includes(o.auto as string) ? (o.auto as AutoKind) : null;
    out.push({ id: id.slice(0, 64), text: text.slice(0, 500), ...(Number.isInteger(w) && w >= 1 && w <= 5 && w !== 1 ? { weight: w } : {}), ...(auto ? { auto } : {}) });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

export const weightOf = (i: ChecklistItem): number => (i.weight && i.weight >= 1 && i.weight <= 5 ? i.weight : 1);

export type DayFacts = { gapPct: number | null; rvol: number | null; catalystStrong: boolean; analyst: boolean };
export type AutoCfg = { gapPct: number; rvol: number };

/** Item id → true for every auto item the day's data confirms (never unticks: a manual tick stays). */
export function prefillChecks(items: readonly ChecklistItem[], f: DayFacts, cfg: AutoCfg): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const i of items) {
    const ok = i.auto === "gap" ? f.gapPct != null && Math.abs(f.gapPct) >= cfg.gapPct
      : i.auto === "rvol" ? f.rvol != null && f.rvol >= cfg.rvol
        : i.auto === "catalyst" ? f.catalystStrong
          : i.auto === "analyst" ? f.analyst : false;
    if (ok) out[i.id] = true;
  }
  return out;
}

export type Score = { score: number; max: number; threshold: number; passed: boolean };

export function scoreOf(items: readonly ChecklistItem[], checks: Readonly<Record<string, boolean>>, threshold: number | null): Score | null {
  if (!items.length) return null;
  const max = items.reduce((a, i) => a + weightOf(i), 0);
  const score = items.reduce((a, i) => a + (checks[i.id] ? weightOf(i) : 0), 0);
  const thr = threshold != null && threshold > 0 ? Math.min(threshold, max) : max;
  return { score, max, threshold: thr, passed: score >= thr };
}

export function suggestedRisk(oneR: number | null, s: Score | null, factor: number): { usd: number | null; reduced: boolean } {
  if (oneR == null || !(oneR > 0)) return { usd: null, reduced: false };
  if (!s || s.passed) return { usd: oneR, reduced: false };
  return { usd: Math.round(oneR * factor * 100) / 100, reduced: true };
}

export const SCORE_BANDS = ["pass", "near", "low", "none"] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number];

export function bandOf(s: Pick<Score, "score" | "threshold"> | null): ScoreBand {
  if (!s) return "none";
  if (s.score >= s.threshold) return "pass";
  return s.threshold - s.score <= 1 ? "near" : "low";
}
