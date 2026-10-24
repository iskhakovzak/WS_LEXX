/**
 * Intervention log (roadmap R9a; table curator_interventions, migration 0246). Every curator action on a trader writes
 * exactly one row here, so the desk can later estimate what each kind of action changes (R9b, Wave 2: ITS with
 * matched controls and the regression-to-the-mean guard — lib/interventions/effect.ts plugs in on these rows).
 *
 * Writers (each calls logInterventionSafe once per action; source_table + source_id are UNIQUE, so a retried call and
 * the migration's one-time backfill never duplicate a row):
 *   PUT  /risk/limits/:trader, POST /risk/templates/apply   limit_change     (trader_risk_limit_events)
 *   POST /rules (office rule), PATCH enabled, DELETE         rule_added / rule_removed (trading_rules)
 *   PUT  /daily/focus/:trader/:date (a mistake)             focus_set        (daily_focus)
 *   POST /academy/one-on-ones                                one_on_one       (academy_one_on_ones)
 *   lib/quests assignQuest (curator quest)                   quest            (quest_instances)
 *   POST /scaling/proposals/:id/approve, /scaling/assign     scaling_decision (scaling_history)
 *   POST /curator/notes kind «concern», PATCH → concern      concern_note     (curator_notes)
 *   R6 plateau escalation (system) and «Назначить разбор 1:1» plateau_review (trader_progress_snapshots / academy_one_on_ones)
 *   R5 rule trials (Wave 2)                                  rule_trial       (rule_trials)
 *
 * A staff member acting on himself is not an intervention (author = trader is skipped). Logging never fails the
 * action that triggered it (logInterventionSafe swallows and warns).
 */
import { pool } from "@workspace/db";
import { logger } from "../logger";
import { nyDate } from "../tradingDate";

export const INTERVENTION_KINDS = [
  "limit_change", "size_change", "rule_added", "rule_removed", "rule_trial", "focus_set", "one_on_one", "pause", "quest",
  "fee_plan", "concern_note", "plateau_review", "scaling_decision",
] as const;
export type InterventionKind = (typeof INTERVENTION_KINDS)[number];

export const INTERVENTION_TRIGGERS = ["scheduled", "after_bad_period", "plateau", "breach", "random", "trader_request"] as const;
export type InterventionTrigger = (typeof INTERVENTION_TRIGGERS)[number];

/** The author of detector rows (plateau escalations): not a curator action. */
export const SYSTEM_AUTHOR = "system";

/** Pre-registered outcome per kind (R9b reads it; avoids metric shopping later). */
const DEFAULT_METRIC: Record<InterventionKind, string> = {
  limit_change: "net_daily", size_change: "net_daily", rule_added: "net_daily", rule_removed: "net_daily", rule_trial: "net_daily",
  focus_set: "mistake_cost", one_on_one: "net_daily", pause: "net_daily", quest: "quest_progress", fee_plan: "fees_daily",
  concern_note: "net_daily", plateau_review: "net_daily", scaling_decision: "net_daily",
};

export type InterventionInput = {
  trader: string;
  kind: InterventionKind;
  author: string | null;
  params?: Record<string, unknown>;
  targetMetric?: string | null;
  targetSlice?: string | null;
  /** Omitted → derived in SQL (curator_intervention_trigger: breach / after_bad_period / scheduled). */
  trigger?: InterventionTrigger;
  /** NY trading date of the action; default today (NY). */
  startedOn?: string;
  endsOn?: string | null;
  sourceTable: string;
  sourceId: string | number;
};

export type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Is this an intervention at all (a staff member on someone else, or a detector row)? Pure. */
export function countsAsIntervention(x: Pick<InterventionInput, "trader" | "author">): boolean {
  if (!x.trader || x.trader === "*") return false;
  return x.author == null || x.author === SYSTEM_AUTHOR || x.author !== x.trader;
}

/** Writes one row; null when skipped (self-action) or the source row is already logged. Throws on DB errors. */
export async function logIntervention(x: InterventionInput, db: Queryable = pool): Promise<number | null> {
  if (!countsAsIntervention(x)) return null;
  const startedOn = x.startedOn && YMD.test(x.startedOn) ? x.startedOn : nyDate();
  const endsOn = x.endsOn && YMD.test(x.endsOn) ? x.endsOn : null;
  const { rows } = await db.query(
    `INSERT INTO curator_interventions (trader, kind, params, target_metric, target_slice, trigger, started_on, ends_on, author, source_table, source_id)
     VALUES ($1, $2, $3::jsonb, $4, $5, COALESCE($6, curator_intervention_trigger($1, $7::date)), $7::date, $8::date, $9, $10, $11)
     ON CONFLICT (source_table, source_id) DO NOTHING
     RETURNING id`,
    [
      x.trader, x.kind, JSON.stringify(x.params ?? {}), x.targetMetric ?? DEFAULT_METRIC[x.kind], x.targetSlice ?? null,
      x.trigger ?? null, startedOn, endsOn, x.author, x.sourceTable, String(x.sourceId),
    ],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

/** logIntervention that never throws (the action itself already succeeded). */
export async function logInterventionSafe(x: InterventionInput, db: Queryable = pool): Promise<number | null> {
  try {
    return await logIntervention(x, db);
  } catch (err) {
    logger.warn({ err: (err as Error)?.message, kind: x.kind, source: x.sourceTable }, "interventions: log failed");
    return null;
  }
}

export type InterventionRow = {
  id: number;
  trader: string;
  kind: InterventionKind;
  params: Record<string, unknown>;
  targetMetric: string | null;
  targetSlice: string | null;
  trigger: InterventionTrigger;
  startedOn: string;
  endsOn: string | null;
  author: string | null;
  sourceTable: string | null;
  createdAt: string;
};

function rowOf(r: any): InterventionRow {
  return {
    id: Number(r.id), trader: String(r.trader), kind: r.kind, params: r.params ?? {}, targetMetric: r.target_metric ?? null,
    targetSlice: r.target_slice ?? null, trigger: r.trigger, startedOn: String(r.started_on), endsOn: r.ends_on ?? null,
    author: r.author ?? null, sourceTable: r.source_table ?? null, createdAt: new Date(r.created_at).toISOString(),
  };
}

/** The trader's interventions, newest first (dates as YYYY-MM-DD). */
export async function listInterventions(trader: string, limit = 50, db: Queryable = pool): Promise<InterventionRow[]> {
  const { rows } = await db.query(
    `SELECT id, trader, kind, params, target_metric, target_slice, trigger, to_char(started_on, 'YYYY-MM-DD') AS started_on,
            to_char(ends_on, 'YYYY-MM-DD') AS ends_on, author, source_table, created_at
       FROM curator_interventions WHERE trader = $1 ORDER BY started_on DESC, id DESC LIMIT $2`,
    [trader, Math.max(1, Math.min(500, limit))],
  );
  return rows.map(rowOf);
}

/**
 * Latest curator-authored intervention per trader on or after `since` (detector rows excluded): the plateau detector's
 * dip suppression and its «escalated, nothing done» check.
 */
export async function lastCuratorInterventions(traders: readonly string[], since: string, db: Queryable = pool): Promise<Map<string, string>> {
  if (!traders.length) return new Map();
  const { rows } = await db.query(
    `SELECT trader, to_char(MAX(started_on), 'YYYY-MM-DD') AS last
       FROM curator_interventions
      WHERE trader = ANY($1::text[]) AND started_on >= $2::date AND COALESCE(author, '') <> $3
      GROUP BY trader`,
    [traders, since, SYSTEM_AUTHOR],
  );
  return new Map(rows.map((r) => [String(r.trader), String(r.last)]));
}
