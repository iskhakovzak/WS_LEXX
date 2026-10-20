/**
 * Loader of the behaviour engine's daily discipline index (lib/behaviorEngine `report.discipline`, 0–100) — the days
 * behind lib/disciplineIndex disciplineIndexOf, the one discipline score of the ladder (IMPROVEMENT_PLAN 2.7).
 * Used by routes/academy-path and /scaling: behaviour rows (routes/behavior) → analyzeBehavior with the
 * day-contract deltas (lib/daily/discipline). Modules load lazily; null when the engine is unavailable.
 */
import { logger } from "./logger";
import { rulesNeedDiscipline, type DisciplineDay } from "./disciplineIndex";
import { windowStart, type Rule } from "./scalingEngine";

type Loaded = {
  beh: typeof import("../routes/behavior");
  eng: typeof import("./behaviorEngine");
  contractDeltas: typeof import("./daily/discipline").contractDeltas;
};

async function modules(): Promise<Loaded | null> {
  try {
    const [beh, eng, disc] = await Promise.all([import("../routes/behavior"), import("./behaviorEngine"), import("./daily/discipline")]);
    if (typeof beh.loadBehaviorRows !== "function" || typeof eng.analyzeBehavior !== "function") return null;
    return { beh, eng, contractDeltas: disc.contractDeltas };
  } catch (err) {
    logger.debug({ err }, "disciplineDays: behaviour engine unavailable");
    return null;
  }
}

type Row = Awaited<ReturnType<Loaded["beh"]["loadBehaviorRows"]>>[number];

async function daysOf(m: Loaded, user: string, rows: Row[], from: string, to: string): Promise<DisciplineDay[] | null> {
  try {
    const trades = rows.map(m.beh.rowToBehaviorTrade);
    const contract = await m.contractDeltas(user, trades, from, to, async (f, t) => (await m.beh.loadBehaviorRows(user, f, t)).map(m.beh.rowToBehaviorTrade));
    return m.eng.analyzeBehavior(trades, {}, undefined, contract).discipline.map((d) => ({ date: d.date, score: d.score }));
  } catch (err) {
    logger.debug({ err, user }, "disciplineDays: analysis failed");
    return null;
  }
}

/** One trader's daily discipline index over [from, to]; null when the behaviour engine is unavailable. */
export async function loadDisciplineDays(user: string, from: string, to: string): Promise<DisciplineDay[] | null> {
  const m = await modules();
  if (!m) return null;
  try {
    return await daysOf(m, user, await m.beh.loadBehaviorRows(user, from, to), from, to);
  } catch (err) {
    logger.debug({ err, user }, "disciplineDays: rows unavailable");
    return null;
  }
}

/**
 * Many traders at once (the /scaling desk): one rows query, then the engine per trader (`concurrency` at a time —
 * each needs its day-contract ledger). Traders without trades get [] (no index days); the map is empty when the
 * engine is unavailable.
 */
export async function loadDisciplineDaysFor(users: readonly string[], from: string, to: string, concurrency = 4): Promise<Map<string, DisciplineDay[] | null>> {
  const out = new Map<string, DisciplineDay[] | null>();
  if (!users.length) return out;
  const m = await modules();
  if (!m) return out;
  let rows: Row[];
  try {
    rows = await m.beh.loadBehaviorRows(null, from, to, undefined, [...users]);
  } catch (err) {
    logger.debug({ err }, "disciplineDays: rows unavailable");
    return out;
  }
  const byUser = new Map<string, Row[]>(users.map((u) => [u, []]));
  for (const r of rows) byUser.get(String(r.trader ?? ""))?.push(r);
  const queue = [...byUser.entries()];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [user, list] = next;
      out.set(user, list.length ? await daysOf(m, user, list, from, to) : []);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker));
  return out;
}

/**
 * /scaling (routes/scaling loadInputs): fills `disciplineDays` of every evaluated trader when an enabled rule reads the
 * discipline metric or the page shows it (`view`: GET /scaling/evaluate — desk column, trader card). History like the path's report
 * (2 × the longest window + 10 trading days, ≤ 600) so the engine's per-trader norms are read over a comparable span.
 */
export async function attachDisciplineDays(
  inputs: ReadonlyMap<string, { disciplineDays?: DisciplineDay[] | null }>,
  rules: readonly Pick<Rule, "metric" | "enabled" | "windowDays">[],
  view: boolean,
  today: string,
): Promise<void> {
  if (!inputs.size || (!view && !rulesNeedDiscipline(rules))) return;
  const maxWindow = Math.max(20, ...rules.map((r) => r.windowDays || 20));
  const days = await loadDisciplineDaysFor([...inputs.keys()], windowStart(today, Math.min(600, maxWindow * 2 + 10)), today);
  for (const [name, input] of inputs) input.disciplineDays = days.get(name) ?? null;
}
