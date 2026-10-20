/**
 * Reference examples («эталоны») for the office setups out of the box (Волна 2, item 2.6): audit 2026-10-20 — all 16
 * office setups had 0 examples, so the morning «Сегодня» promised real charts and showed empty cards.
 *
 * The seed takes real desk trades already linked to a setup (trades.playbook_id) and adds the best of them as the setup's
 * examples (playbook_examples) until the setup has `perSetup` live ones (default 3):
 *   - only winners (net > 0, or R > 0 when $ are unknown);
 *   - best first: grade (A+ → A → B → C → none), then R, then net $; at most one per trader-day, so one great session
 *     does not fill a setup;
 *   - tier 1 (эталон) for A+/A or R ≥ 2, else tier 2;
 *   - a trade that already is / was an example of that setup (a curator removed it: deleted_at) is never added again.
 * Idempotent: a second run with the same trades adds nothing. Run by POST /api/playbook/examples/seed (curators with
 * playbook.edit.any). Money of others' trades stays redacted on read (routes/playbook-spaces.ts shapeExample).
 */
import { pool } from "@workspace/db";
import { netPnlSql, resultSql, signedRSql } from "../tradeMath";
import { spaceSql } from "../playbookAccess";

export type ExampleCandidate = {
  tradeId: number; setupId: number; trader: string | null; day: string; grade: string | null; r: number | null; net: number | null;
};
export type ExamplePick = { tradeId: number; setupId: number; tier: 1 | 2 };

const GRADE_RANK: Record<string, number> = { "A+": 4, A: 3, B: 2, C: 1 };
const gradeRank = (g: string | null) => (g ? GRADE_RANK[g.trim()] ?? 0 : 0);
const fin = (v: number | null): v is number => typeof v === "number" && Number.isFinite(v);

/** A winner worth showing: net > 0, or R > 0 when the $ are unknown. */
export function isWinner(c: Pick<ExampleCandidate, "r" | "net">): boolean {
  return fin(c.net) ? c.net > 0 : fin(c.r) && c.r > 0;
}

/** Best first: grade, then R, then net $, then the older trade id (stable). */
export function compareCandidates(a: ExampleCandidate, b: ExampleCandidate): number {
  return gradeRank(b.grade) - gradeRank(a.grade)
    || (fin(b.r) ? b.r : -Infinity) - (fin(a.r) ? a.r : -Infinity)
    || (fin(b.net) ? b.net : -Infinity) - (fin(a.net) ? a.net : -Infinity)
    || a.tradeId - b.tradeId;
}

export function tierFor(c: Pick<ExampleCandidate, "grade" | "r">): 1 | 2 {
  return gradeRank(c.grade) >= GRADE_RANK.A || (fin(c.r) && c.r >= 2) ? 1 : 2;
}

/**
 * Pure: what to add. `have` = live examples per setup; `excluded` = "setupId:tradeId" pairs that are or were examples;
 * `takenDays` = "setupId|trader|day" of the live examples. Each setup gets up to `perSetup − have` new examples, one per
 * trader-day (counting the examples it already has).
 */
export function pickExamples(
  candidates: readonly ExampleCandidate[], have: ReadonlyMap<number, number>, excluded: ReadonlySet<string>, perSetup = 3,
  takenDays: ReadonlySet<string> = new Set(),
): ExamplePick[] {
  const bySetup = new Map<number, ExampleCandidate[]>();
  for (const c of candidates) {
    if (!isWinner(c) || excluded.has(`${c.setupId}:${c.tradeId}`)) continue;
    const list = bySetup.get(c.setupId) ?? [];
    list.push(c);
    bySetup.set(c.setupId, list);
  }
  const out: ExamplePick[] = [];
  for (const [setupId, list] of [...bySetup.entries()].sort((a, b) => a[0] - b[0])) {
    let need = perSetup - (have.get(setupId) ?? 0);
    if (need <= 0) continue;
    const seen = new Set<string>();
    for (const c of [...list].sort(compareCandidates)) {
      if (need <= 0) break;
      const td = `${c.trader ?? ""}|${c.day}`;
      if (seen.has(td) || takenDays.has(`${setupId}|${td}`)) continue;
      seen.add(td);
      out.push({ tradeId: c.tradeId, setupId, tier: tierFor(c) });
      need--;
    }
  }
  return out;
}

export type SeedResult = {
  perSetup: number;
  dryRun: boolean;
  added: number;
  setups: { setupId: number; name: string; before: number; added: number[] }[];
};

/** Add the picks (or only report them with dryRun). Office setups only; deleted / locked-away setups are not touched. */
export async function seedPlaybookExamples(opts: { actor: string | null; perSetup?: number; dryRun?: boolean }): Promise<SeedResult> {
  const perSetup = Math.min(5, Math.max(1, Math.floor(opts.perSetup ?? 3)));
  const dryRun = opts.dryRun === true;
  const { rows: setups } = await pool.query<{ id: number; name: string; live: number }>(
    `SELECT p.id, p.name,
            (SELECT COUNT(*)::int FROM playbook_examples e JOIN trades t ON t.id = e.trade_id AND t.deleted_at IS NULL
              WHERE e.playbook_id = p.id AND e.deleted_at IS NULL) AS live
       FROM playbook p
      WHERE p.deleted_at IS NULL AND ${spaceSql("p")} = 'office'
      ORDER BY p.id`,
  );
  const open = setups.filter((s) => Number(s.live) < perSetup);
  const result: SeedResult = { perSetup, dryRun, added: 0, setups: [] };
  if (!open.length) return result;
  const ids = open.map((s) => Number(s.id));
  const [{ rows: cand }, { rows: ex }] = await Promise.all([
    pool.query<any>(
      `SELECT t.id, t.playbook_id, t.trader, LEFT(t.date, 10) AS day, t.confidence_grade AS grade,
              ${signedRSql("t")}::float AS r, ${netPnlSql("t")}::float AS net
         FROM trades t
        WHERE t.playbook_id = ANY($1::int[]) AND t.deleted_at IS NULL AND ${resultSql("t")} = 'win'`,
      [ids],
    ),
    pool.query<{ playbook_id: number; trade_id: number; live: boolean; trader: string | null; day: string | null }>(
      `SELECT e.playbook_id, e.trade_id, (e.deleted_at IS NULL) AS live, t.trader, LEFT(t.date, 10) AS day
         FROM playbook_examples e LEFT JOIN trades t ON t.id = e.trade_id
        WHERE e.playbook_id = ANY($1::int[])`,
      [ids],
    ),
  ]);
  const candidates: ExampleCandidate[] = cand.map((r) => ({
    tradeId: Number(r.id), setupId: Number(r.playbook_id), trader: r.trader ?? null, day: String(r.day ?? ""),
    grade: r.grade ?? null, r: r.r == null ? null : Number(r.r), net: r.net == null ? null : Number(r.net),
  }));
  const excluded = new Set(ex.map((e) => `${e.playbook_id}:${e.trade_id}`));
  const have = new Map(open.map((s) => [Number(s.id), Number(s.live)]));
  const takenDays = new Set(ex.filter((e) => e.live).map((e) => `${e.playbook_id}|${e.trader ?? ""}|${e.day ?? ""}`));
  const picks = pickExamples(candidates, have, excluded, perSetup, takenDays);
  const bySetup = new Map<number, number[]>();
  for (const p of picks) {
    if (!dryRun) {
      // Guarded insert: a concurrent run or a curator adding the same trade meanwhile never duplicates it.
      const { rowCount } = await pool.query(
        `INSERT INTO playbook_examples (playbook_id, trade_id, tier, note, added_by, sort_order)
         SELECT $1, $2, $3, NULL, $4,
                COALESCE((SELECT MAX(sort_order) + 1 FROM playbook_examples WHERE playbook_id = $1 AND tier = $3 AND deleted_at IS NULL), 0)
          WHERE NOT EXISTS (SELECT 1 FROM playbook_examples WHERE playbook_id = $1 AND trade_id = $2)`,
        [p.setupId, p.tradeId, p.tier, opts.actor],
      );
      if (!rowCount) continue;
    }
    const list = bySetup.get(p.setupId) ?? [];
    list.push(p.tradeId);
    bySetup.set(p.setupId, list);
    result.added++;
  }
  result.setups = open.map((s) => ({ setupId: Number(s.id), name: s.name, before: Number(s.live), added: bySetup.get(Number(s.id)) ?? [] }));
  return result;
}
