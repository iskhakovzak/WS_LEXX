/**
 * Plateau detector storage, the job run and the curator actions (roadmap R6; table trader_progress_snapshots,
 * migration 0250; pure engine lib/plateau.ts).
 *
 *   runPlateau()            job academy.plateau-monthly (07:00 NY weekdays; the 1st trading day of a month = monthly,
 *                           Mondays = weekly refresh, other days skip): every active trader → one snapshot; an escalation
 *                           writes an R9 row (kind plateau_review, author «system», trigger plateau)
 *   stuckList(traders)      the curator «Застряли» section: the latest plateau snapshot per trader (not suppressed)
 *   plateauSignals(traders) the curator priority (R11): plateau / severity / an open escalation (escalated in the last
 *                           30 trading days and no 1:1 or plateau review logged by a person since)
 *   scheduleReview()        «Назначить разбор 1:1 по шаблону»: an academy_one_on_ones row with the diagnosis-pack agenda
 *                           (in the curator's language) + one R9 row (plateau_review, trigger plateau)
 *
 * Staff-only data: nothing here is ever sent to the trader («you are stuck» is never shown to a junior).
 */
import { pool } from "@workspace/db";
import { nyDate, addDays } from "./tradingDate";
import { setting } from "./settings/registry";
import { loadCriteria } from "./academyPathStore";
import { DEFAULT_CRITERIA } from "./promotionEngine";
import { loadStageInfo } from "./people/stage";
import { marketClosedDays } from "./curatorStore";
import { computePlateau, addWeekdays, firstTradingDayOfMonth, runKindOn, weekdaysBetween, PLATEAU, type PlateauResult, type PriorRun, type RunKind, type TraderSeries } from "./plateau";
import { topVerdicts, type EdgeVerdict } from "./edgeMapStore";
import { lastCuratorInterventions, logIntervention, SYSTEM_AUTHOR, type Queryable } from "./interventions/log";
import { coachT } from "../i18n/ns";
import type { Lang } from "../i18n";
import { usd } from "./dayReport";

/** The diagnosis pack attached to a snapshot (codes and numbers only; rendered per reader). */
export type Diagnosis = {
  /** R1 binding readiness criterion — owner decision pending; null until R1 lands. */
  binding: null;
  edge: { leaks: EdgeVerdict[]; strengths: EdgeVerdict[] };
  /** Σ|fees| ÷ gross over the lookback (%); null when gross ≤ 0. R2 adds the per-band model. */
  feeSharePct: number | null;
  /** R12 style-drift events; empty until R12 lands. */
  drift: [];
  /** R7 suggested actions; empty until R7 lands. */
  actions: [];
};

/** Target pace ($ / day) per stage from the editable criteria (net_pnl threshold ÷ window), defaults otherwise. */
export async function paceTargets(): Promise<Map<string, number>> {
  const criteria = await loadCriteria().catch(() => []);
  const list = criteria.length ? criteria : DEFAULT_CRITERIA;
  const out = new Map<string, number>();
  for (const c of list) {
    if (c.metric === "net_pnl" && c.enabled !== false && c.windowDays && c.windowDays > 0) out.set(c.fromStage, c.value / c.windowDays);
  }
  return out;
}

type DayRow = { trader: string; day: string; net: number; fees: number; gross: number };

async function dailyRows(traders: readonly string[], asOf: string, db: Queryable): Promise<DayRow[]> {
  if (!traders.length) return [];
  const { rows } = await db.query(
    `SELECT trader, LEFT(COALESCE(exit_date, date), 10) AS day,
            SUM(pnl - ABS(COALESCE(fees, 0)))::float AS net, SUM(ABS(COALESCE(fees, 0)))::float AS fees, SUM(pnl)::float AS gross
       FROM trades
      WHERE deleted_at IS NULL AND pnl IS NOT NULL AND LOWER(TRIM(result)) <> 'open' AND trader = ANY($1::text[])
        AND LEFT(COALESCE(exit_date, date), 10) <= $2
      GROUP BY 1, 2`,
    [traders, asOf],
  );
  return rows.map((r) => ({ trader: String(r.trader), day: String(r.day), net: Number(r.net), fees: Number(r.fees), gross: Number(r.gross) }));
}

async function activeTraders(db: Queryable): Promise<string[]> {
  const { rows } = await db.query(`SELECT name FROM users WHERE role = 'trader' AND active = true AND COALESCE(banned, false) = false ORDER BY name`);
  return rows.map((r) => String(r.name));
}

async function priorRunsOf(traders: readonly string[], asOf: string, db: Queryable): Promise<Map<string, PriorRun[]>> {
  const { rows } = await db.query(
    `SELECT trader, to_char(as_of, 'YYYY-MM-DD') AS as_of, plateau, escalated FROM trader_progress_snapshots
      WHERE run_kind = 'monthly' AND as_of < $2::date AND trader = ANY($1::text[]) ORDER BY as_of DESC`,
    [traders, asOf],
  );
  const out = new Map<string, PriorRun[]>();
  for (const r of rows) out.set(String(r.trader), [...(out.get(String(r.trader)) ?? []), { asOf: String(r.as_of), plateau: !!r.plateau, escalated: !!r.escalated }]);
  return out;
}

/** Latest method change per trader since `since`: a person's R9 intervention or a playbook change. */
async function methodChanges(traders: readonly string[], since: string, db: Queryable): Promise<Map<string, string>> {
  const out = await lastCuratorInterventions(traders, since, db);
  const { rows } = await db
    .query(
      `SELECT trader, to_char(MAX(created_at AT TIME ZONE 'America/New_York'), 'YYYY-MM-DD') AS d FROM playbook_revisions
        WHERE trader = ANY($1::text[]) AND created_at >= $2::date GROUP BY trader`,
      [traders, since],
    )
    .catch(() => ({ rows: [] as any[] }));
  for (const r of rows) {
    const t = String(r.trader);
    if (r.d && (!out.has(t) || String(r.d) > out.get(t)!)) out.set(t, String(r.d));
  }
  return out;
}

export type PlateauRun = { asOf: string; kind: RunKind | null; traders: number; plateaus: number; escalations: number; adminEscalations: number; skipped?: string; catchUp?: string[] };

/**
 * The job's run for `asOf` (default today, NY). First a catch-up: the monthly runs of the previous and the current month
 * (as of their first trading days, oldest first, each on the data of its own date) when they are missing — a fresh
 * deployment or a missed day then still has the «2 consecutive monthly runs» history. Then the run of the day: monthly
 * on the 1st trading day, weekly on Mondays; another day runs only when `manual` (a weekly refresh) or `kind` is given.
 */
export async function runPlateau(opts: { asOf?: string; kind?: RunKind; manual?: boolean; signal?: AbortSignal; db?: Queryable } = {}): Promise<PlateauRun> {
  const db = opts.db ?? pool;
  const asOf = opts.asOf ?? nyDate();
  const holidays = await marketClosedDays(asOf, 70);
  const catchUp: string[] = [];
  for (const back of [1, 0]) {
    const d = firstTradingDayOfMonth(asOf, back, holidays);
    if (d >= asOf) continue;
    const { rows } = await db.query(`SELECT 1 FROM trader_progress_snapshots WHERE run_kind = 'monthly' AND as_of = $1::date LIMIT 1`, [d]);
    if (rows.length) continue;
    await runOnce(d, "monthly", db, opts.signal);
    catchUp.push(d);
  }
  const kind = opts.kind ?? runKindOn(asOf, holidays) ?? (opts.manual ? "weekly" : null);
  if (!kind) return { asOf, kind: null, traders: 0, plateaus: 0, escalations: 0, adminEscalations: 0, skipped: "not a run day", catchUp };
  return { ...(await runOnce(asOf, kind, db, opts.signal)), catchUp };
}

async function runOnce(asOf: string, kind: RunKind, db: Queryable, signal?: AbortSignal): Promise<PlateauRun> {
  const traders = await activeTraders(db);
  const [rows, stages, paces, priorRuns, changes, lastAny, edge] = await Promise.all([
    dailyRows(traders, asOf, db),
    loadStageInfo(traders),
    paceTargets(),
    priorRunsOf(traders, asOf, db),
    methodChanges(traders, addDays(asOf, -60), db),
    lastCuratorInterventions(traders, "2000-01-01", db),
    topVerdicts(traders, db),
  ]);
  if (signal?.aborted) throw new Error("aborted");
  const byTrader = new Map<string, DayRow[]>();
  for (const r of rows) byTrader.set(r.trader, [...(byTrader.get(r.trader) ?? []), r]);
  const series: TraderSeries[] = traders.map((t) => ({
    trader: t, stage: stages.get(t)?.stage ?? null, stageSince: stages.get(t)?.since ?? null, days: byTrader.get(t) ?? [],
  }));
  const results = computePlateau(series, {
    asOf, kind, minTenure: setting("academy.plateau.minTenure"), paceOf: (s) => (s ? paces.get(s) ?? null : null),
    priorRuns, methodChange: changes, lastIntervention: lastAny,
  });
  let escalations = 0;
  for (const r of results) {
    const lookback = (byTrader.get(r.trader) ?? []).filter((d) => d.day <= asOf).sort((a, b) => a.day.localeCompare(b.day)).slice(-r.nDays);
    const gross = lookback.reduce((s, d) => s + d.gross, 0);
    const fees = lookback.reduce((s, d) => s + d.fees, 0);
    const diagnosis: Diagnosis = {
      binding: null, edge: edge.get(r.trader) ?? { leaks: [], strengths: [] }, feeSharePct: gross > 0 ? Math.round((1000 * fees) / gross) / 10 : null, drift: [], actions: [],
    };
    const id = await saveSnapshot(r, diagnosis, db);
    if (r.escalated && id) {
      escalations++;
      await logIntervention({
        trader: r.trader, kind: "plateau_review", author: SYSTEM_AUTHOR, trigger: "plateau", startedOn: asOf,
        params: { severity: r.severity, tenure: r.tenure, escalation: true, admin: r.adminEscalated }, sourceTable: "trader_progress_snapshots", sourceId: id,
      }, db);
    }
  }
  return {
    asOf, kind, traders: results.length, plateaus: results.filter((r) => r.plateau).length, escalations,
    adminEscalations: results.filter((r) => r.adminEscalated).length,
  };
}

async function saveSnapshot(r: PlateauResult, diagnosis: Diagnosis, db: Queryable): Promise<number | null> {
  const { rows } = await db.query(
    `INSERT INTO trader_progress_snapshots (trader, as_of, run_kind, tenure_active_days, stage, pace_target, n_days, mean_raw, mean_lb, lo80, hi80,
                                            p_impr, shrunk, plateau, severity, escalated, admin_escalated, suppressed_until, diagnosis)
     VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::date, $19::jsonb)
     ON CONFLICT (trader, as_of, run_kind) DO UPDATE SET tenure_active_days = EXCLUDED.tenure_active_days, stage = EXCLUDED.stage,
       pace_target = EXCLUDED.pace_target, n_days = EXCLUDED.n_days, mean_raw = EXCLUDED.mean_raw, mean_lb = EXCLUDED.mean_lb,
       lo80 = EXCLUDED.lo80, hi80 = EXCLUDED.hi80, p_impr = EXCLUDED.p_impr, shrunk = EXCLUDED.shrunk, plateau = EXCLUDED.plateau,
       severity = EXCLUDED.severity, escalated = trader_progress_snapshots.escalated OR EXCLUDED.escalated,
       admin_escalated = trader_progress_snapshots.admin_escalated OR EXCLUDED.admin_escalated, suppressed_until = EXCLUDED.suppressed_until,
       diagnosis = EXCLUDED.diagnosis, created_at = now()
     RETURNING id`,
    [
      r.trader, r.asOf, r.kind, r.tenure, r.stage, r.pace, r.nDays, r.meanRaw, r.mean, r.lo80, r.hi80, r.pImpr, r.shrunk, r.plateau, r.severity,
      r.escalated, r.adminEscalated, r.suppressedUntil, JSON.stringify(diagnosis),
    ],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

export type StuckItem = {
  trader: string;
  asOf: string;
  kind: RunKind;
  tenure: number;
  stage: string | null;
  severity: "slow" | "stuck" | "stuck_long";
  pace: number | null;
  mean: number | null;
  lo80: number | null;
  hi80: number | null;
  pImpr: number | null;
  escalated: boolean;
  adminEscalated: boolean;
  /** The latest escalation is open: no 1:1 / plateau review by a person since it. */
  escalationOpen: boolean;
  /** Date of the latest 1:1 / plateau review a person logged after the latest escalation (null = none). */
  reviewedOn: string | null;
  diagnosis: Diagnosis;
};

const numOrNull = (v: unknown) => (v == null ? null : Number(v));

async function latestSnapshots(traders: readonly string[], db: Queryable): Promise<any[]> {
  if (!traders.length) return [];
  const { rows } = await db.query(
    `SELECT DISTINCT ON (trader) trader, to_char(as_of, 'YYYY-MM-DD') AS as_of, run_kind, tenure_active_days, stage, pace_target, mean_lb, lo80, hi80, p_impr,
            plateau, severity, escalated, admin_escalated, to_char(suppressed_until, 'YYYY-MM-DD') AS suppressed_until, diagnosis
       FROM trader_progress_snapshots WHERE trader = ANY($1::text[])
      ORDER BY trader, as_of DESC, (run_kind = 'monthly') DESC`,
    [traders],
  );
  return rows;
}

/** Latest escalation date per trader and the latest person-logged review (1:1 / plateau review) per trader. */
async function escalationState(traders: readonly string[], db: Queryable): Promise<{ escalatedOn: Map<string, string>; reviewedOn: Map<string, string> }> {
  if (!traders.length) return { escalatedOn: new Map(), reviewedOn: new Map() };
  const [esc, rev] = await Promise.all([
    db.query(
      `SELECT trader, to_char(MAX(as_of), 'YYYY-MM-DD') AS d FROM trader_progress_snapshots WHERE escalated AND trader = ANY($1::text[]) GROUP BY trader`,
      [traders],
    ),
    db.query(
      `SELECT trader, to_char(MAX(started_on), 'YYYY-MM-DD') AS d FROM curator_interventions
        WHERE trader = ANY($1::text[]) AND kind IN ('plateau_review', 'one_on_one') AND COALESCE(author, '') <> $2 GROUP BY trader`,
      [traders, SYSTEM_AUTHOR],
    ),
  ]);
  return {
    escalatedOn: new Map(esc.rows.map((r: any) => [String(r.trader), String(r.d)])),
    reviewedOn: new Map(rev.rows.map((r: any) => [String(r.trader), String(r.d)])),
  };
}

/** The «Застряли» list: latest snapshot per trader that is a plateau and not suppressed today; escalated first. */
export async function stuckList(traders: readonly string[], today = nyDate(), db: Queryable = pool): Promise<StuckItem[]> {
  const [snaps, state] = await Promise.all([latestSnapshots(traders, db), escalationState(traders, db)]);
  const out: StuckItem[] = [];
  for (const s of snaps) {
    if (!s.plateau || !s.severity) continue;
    if (s.suppressed_until && today < s.suppressed_until) continue;
    const t = String(s.trader);
    const esc = state.escalatedOn.get(t) ?? null;
    const rev = state.reviewedOn.get(t) ?? null;
    const reviewedOn = esc && rev && rev >= esc ? rev : null;
    out.push({
      trader: t, asOf: String(s.as_of), kind: s.run_kind, tenure: Number(s.tenure_active_days), stage: s.stage ?? null, severity: s.severity,
      pace: numOrNull(s.pace_target), mean: numOrNull(s.mean_lb), lo80: numOrNull(s.lo80), hi80: numOrNull(s.hi80), pImpr: numOrNull(s.p_impr),
      escalated: !!esc, adminEscalated: !!s.admin_escalated,
      escalationOpen: !!esc && !reviewedOn && weekdaysBetween(esc, today) <= PLATEAU.escalateGapDays,
      reviewedOn, diagnosis: s.diagnosis ?? { binding: null, edge: { leaks: [], strengths: [] }, feeSharePct: null, drift: [], actions: [] },
    });
  }
  const rank = (x: StuckItem) => (x.escalationOpen ? 0 : x.escalated && !x.reviewedOn ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || b.tenure - a.tenure || a.trader.localeCompare(b.trader));
}

export type PlateauSignal = { plateau: boolean; severity: StuckItem["severity"] | null; escalationOpen: boolean; adminEscalated: boolean };

/** Per-trader plateau state for the curator priority (R11). Missing table / no snapshot → no signal. */
export async function plateauSignals(traders: readonly string[], today = nyDate(), db: Queryable = pool): Promise<Map<string, PlateauSignal>> {
  const list = await stuckList(traders, today, db).catch(() => [] as StuckItem[]);
  return new Map(list.map((x) => [x.trader, { plateau: true, severity: x.severity, escalationOpen: x.escalationOpen, adminEscalated: x.adminEscalated }]));
}

/** Human slice label for the agenda (mirrors the web edge-map labels). */
function sliceText(lang: Lang, key: string): string {
  const t = (k: string, p?: Record<string, string | number>) => coachT.tryFor(lang, `slice.${k}`, p);
  const i = key.indexOf(":");
  const family = key.slice(0, i);
  const value = key.slice(i + 1);
  if (family === "time") return (value === "before-8:30" ? t("timeBefore") : value === "after-16:00" ? t("timeAfter") : t("timeRange", { range: value.replace("-", "–") })) ?? key;
  if (family === "seq") return (value === "4-5" ? t("seq45") : value === "6+" ? t("seq6") : t("seqN", { n: value })) ?? key;
  if (family === "price") return t("price", { range: value.startsWith("lt") ? `< $${value.slice(2)}` : value.startsWith("gt") ? `> $${value.slice(2)}` : `$${value.replace("-", "–")}` }) ?? key;
  if (family === "rapid") return t("rapid") ?? key;
  return t(`${family}.${value}`) ?? key;
}

/** The 1:1 agenda from a stuck item's diagnosis pack, in `lang`. Pure. */
export function agendaText(x: Pick<StuckItem, "mean" | "lo80" | "hi80" | "pace" | "tenure" | "diagnosis">, lang: Lang): string {
  const t = coachT.tFor(lang);
  const lines = [t("agenda.title")];
  lines.push(x.mean != null && x.pace != null && x.lo80 != null && x.hi80 != null
    ? t("agenda.pace", { mean: usd(x.mean, true), lo: usd(x.lo80, true), hi: usd(x.hi80, true), pace: usd(x.pace), tenure: x.tenure })
    : t("agenda.paceUnknown", { tenure: x.tenure }));
  const { leaks, strengths } = x.diagnosis.edge;
  for (const v of leaks) lines.push(`• ${t("agenda.lose", { slice: sliceText(lang, v.sliceKey), perDay: usd(v.perDay, true), lo: usd(v.perDayLo, true), hi: usd(v.perDayHi, true) })}`);
  for (const v of strengths) lines.push(`• ${t("agenda.earn", { slice: sliceText(lang, v.sliceKey), perDay: usd(v.perDay, true), lo: usd(v.perDayLo, true), hi: usd(v.perDayHi, true) })}`);
  if (!leaks.length && !strengths.length) lines.push(`• ${t("agenda.noEdge")}`);
  if (x.diagnosis.feeSharePct != null) lines.push(`• ${t("agenda.fees", { pct: x.diagnosis.feeSharePct })}`);
  lines.push(t("agenda.close"));
  return lines.join("\n");
}

/**
 * «Назначить разбор 1:1 по шаблону»: a meeting on the next trading day at 12:00 NY with the agenda from the diagnosis
 * pack, and one R9 row (plateau_review). Null when the trader has no current plateau snapshot.
 */
export async function scheduleReview(trader: string, actor: string, lang: Lang, today = nyDate(), db: Queryable = pool): Promise<{ meetingId: number; metAt: string; interventionId: number | null } | null> {
  const [item] = (await stuckList([trader], today, db)).filter((x) => x.trader === trader);
  if (!item) return null;
  const day = addWeekdays(today, 1);
  const { rows } = await db.query(
    `INSERT INTO academy_one_on_ones (student, mentor, met_at, duration_min, format, agenda, created_by)
     VALUES ($1, $2, ($3::date + time '12:00') AT TIME ZONE 'America/New_York', 45, 'office', $4, $2) RETURNING id, met_at`,
    [trader, actor, day, agendaText(item, lang).slice(0, 4000)],
  );
  const meetingId = Number(rows[0].id);
  const interventionId = await logIntervention({
    trader, kind: "plateau_review", author: actor, trigger: "plateau", startedOn: today,
    params: { severity: item.severity, tenure: item.tenure, meetingOn: day }, sourceTable: "academy_one_on_ones", sourceId: meetingId,
  }, db);
  return { meetingId, metAt: new Date(rows[0].met_at).toISOString(), interventionId };
}
