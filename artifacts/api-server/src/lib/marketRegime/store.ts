/**
 * I/O of the market regime layer (migration 0263): the desk regime of each NY trading day (desk_regime_days), the
 * playbook regime tags (playbook.regimes) and the weekly reflection answers (regime_reflections).
 *
 *   regimeDay(day)                one day's row (null = not set)
 *   setRegimeDay(input)           upsert + audit «regime.set» {from, to, auto} (the previous key, so it is reversible)
 *   regimeAdj(day)                today's limit adjustment (regime + multiplier + settings regime.applyLimits); cached
 *                                 REGIME_TTL_MS per day, dropped on every set — /risk and the stop alerts read it often
 *   regimeOfDays(trader)          entry day → regime for a trader's closed trades (edge by regime)
 *   setPlaybookRegimes(id, keys)  the regime tags of one setup
 *   reflection(trader, week)      the answers of a week (or the latest earlier week's, marked as prefilled)
 */
import { pool } from "@workspace/db";
import { logAudit } from "../audit";
import { setting } from "../settings/registry";
import { closedSql, netPnlSql, resultSql, signedRSql } from "../tradeMath";
import { REGIME_KEYS, isRegimeKey, multiplierOf, multiplierSetting, type RegimeKey, type RegimeLimitAdj } from "./regimes";
import { seasonDay } from "../sessionFlow/seasonStore";

export type SuggestionReason = { code: string; value: number | null };
export type StoredSuggestion = { regime: RegimeKey; reasons: SuggestionReason[]; asOf: string };

export type RegimeDay = {
  day: string;
  regime: RegimeKey;
  note: string | null;
  setBy: string;
  autoSuggested: boolean;
  suggestion: StoredSuggestion | null;
  updatedAt: string;
};

type DayRow = { day: string; regime: string; note: string | null; set_by: string; auto_suggested: boolean; suggestion: unknown; updated_at: Date | string };

const iso = (v: Date | string) => new Date(v).toISOString();

function toDay(r: DayRow): RegimeDay | null {
  if (!isRegimeKey(r.regime)) return null;
  const s = r.suggestion as StoredSuggestion | null;
  return {
    day: String(r.day).slice(0, 10), regime: r.regime, note: r.note, setBy: r.set_by, autoSuggested: r.auto_suggested,
    suggestion: s && isRegimeKey(s.regime) ? s : null, updatedAt: iso(r.updated_at),
  };
}

const DAY_COLS = `to_char(day, 'YYYY-MM-DD') AS day, regime, note, set_by, auto_suggested, suggestion, updated_at`;

export async function regimeDay(day: string): Promise<RegimeDay | null> {
  const { rows } = await pool.query<DayRow>(`SELECT ${DAY_COLS} FROM desk_regime_days WHERE day = $1::date`, [day]);
  return rows[0] ? toDay(rows[0]) : null;
}

/** NY day → regime key for a window (office recommendations: the desk's results per regime). */
export async function regimeDaysMap(from: string, to: string): Promise<Map<string, RegimeKey>> {
  const { rows } = await pool.query<{ day: string; regime: string }>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, regime FROM desk_regime_days WHERE day BETWEEN $1::date AND $2::date`,
    [from, to],
  );
  return new Map(rows.filter((r) => isRegimeKey(r.regime)).map((r) => [r.day, r.regime as RegimeKey]));
}

/** Multipliers of every regime as the code reads them now (settings or defaults). */
export function multipliers(): Record<RegimeKey, number> {
  const read = (k: RegimeKey) => setting(multiplierSetting(k));
  return Object.fromEntries(REGIME_KEYS.map((k) => [k, multiplierOf(k, read)])) as Record<RegimeKey, number>;
}

const REGIME_TTL_MS = 30_000;
const adjCache = new Map<string, { at: number; value: Promise<RegimeKey | null> }>();

/** The day's regime key, memoised for REGIME_TTL_MS (a failed read is not cached and counts as «not set»). */
function cachedRegime(day: string): Promise<RegimeKey | null> {
  const hit = adjCache.get(day);
  if (hit && Date.now() - hit.at < REGIME_TTL_MS) return hit.value;
  const value = regimeDay(day).then((d) => d?.regime ?? null).catch(() => {
    adjCache.delete(day);
    return null;
  });
  adjCache.set(day, { at: Date.now(), value });
  if (adjCache.size > 32) adjCache.delete(adjCache.keys().next().value as string);
  return value;
}

/** The limit adjustment of a day: its regime, that regime's multiplier and whether applying is switched on. */
export async function regimeAdj(day: string): Promise<RegimeLimitAdj> {
  const [regime, s] = await Promise.all([cachedRegime(day), seasonDay(day).catch(() => null)]);
  return {
    regime, multiplier: regime ? multipliers()[regime] : 1, apply: setting("regime.applyLimits") === true,
    season: s ? { quiet: s.quiet, factor: s.factor, trim: s.trim } : null,
  };
}

export type SetRegimeInput = { day: string; regime: RegimeKey; note: string | null; actor: string; suggestion: StoredSuggestion | null };

/** Upserts the day; `autoSuggested` = the person confirmed exactly what the engine suggested. Audited with the previous key. */
export async function setRegimeDay(x: SetRegimeInput): Promise<RegimeDay> {
  const before = await regimeDay(x.day);
  const auto = x.suggestion != null && x.suggestion.regime === x.regime;
  const { rows } = await pool.query<DayRow>(
    `INSERT INTO desk_regime_days (day, regime, note, set_by, auto_suggested, suggestion)
     VALUES ($1::date, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (day) DO UPDATE SET regime = EXCLUDED.regime, note = EXCLUDED.note, set_by = EXCLUDED.set_by,
       auto_suggested = EXCLUDED.auto_suggested, suggestion = COALESCE(EXCLUDED.suggestion, desk_regime_days.suggestion),
       updated_at = now()
     RETURNING ${DAY_COLS}`,
    [x.day, x.regime, x.note, x.actor, auto, x.suggestion ? JSON.stringify(x.suggestion) : null],
  );
  adjCache.delete(x.day);
  await logAudit({
    actor: x.actor, action: "regime.set", targetType: "desk_regime_day", targetId: x.day,
    details: { from: before?.regime ?? null, to: x.regime, auto, ...(x.note ? { note: x.note } : {}) },
  });
  const day = toDay(rows[0]!);
  if (!day) throw new Error("desk_regime_days: unreadable row after upsert");
  return day;
}

export type RegimeTrade = { id: number; day: string; regime: RegimeKey | null; net: number; r: number | null; win: boolean | null };

/**
 * Closed trades of a trader with a P&L (net = gross − |fees|, signed R), each with the desk regime of its ENTRY day
 * (null when the desk had no regime that day). Optional window on the entry day.
 */
export async function regimeTrades(trader: string, from?: string, to?: string): Promise<RegimeTrade[]> {
  const params: unknown[] = [trader];
  const win: string[] = [];
  if (from) { params.push(from); win.push(`LEFT(t.date, 10) >= $${params.length}`); }
  if (to) { params.push(to); win.push(`LEFT(t.date, 10) <= $${params.length}`); }
  const { rows } = await pool.query<{ id: number; day: string; regime: string | null; net: number | null; r: number | null; res: string | null }>(
    `SELECT t.id, LEFT(t.date, 10) AS day, d.regime, ${netPnlSql("t")}::float8 AS net, ${signedRSql("t")}::float8 AS r, ${resultSql("t")} AS res
       FROM trades t
       LEFT JOIN desk_regime_days d ON to_char(d.day, 'YYYY-MM-DD') = LEFT(t.date, 10)
      WHERE t.deleted_at IS NULL AND t.trader = $1 AND t.pnl IS NOT NULL AND ${closedSql("t")}
        AND t.date ~ '^\\d{4}-\\d{2}-\\d{2}'${win.map((w) => ` AND ${w}`).join("")}
      ORDER BY t.date, t.id`,
    params,
  );
  return rows.map((r) => ({
    id: Number(r.id), day: r.day, regime: isRegimeKey(r.regime) ? r.regime : null, net: Number(r.net ?? 0),
    r: r.r == null || !Number.isFinite(Number(r.r)) ? null : Number(r.r),
    win: r.res === "win" ? true : r.res === "loss" ? false : null,
  }));
}

/** Replaces the regime tags of a setup (deduplicated, in REGIME_KEYS order). Null when the setup does not exist. */
export async function setPlaybookRegimes(id: number, keys: readonly RegimeKey[]): Promise<RegimeKey[] | null> {
  const clean = REGIME_KEYS.filter((k) => keys.includes(k));
  const { rows } = await pool.query<{ regimes: string[] }>(
    `UPDATE playbook SET regimes = $2::text[], updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING regimes`,
    [id, clean],
  );
  return rows[0] ? rows[0].regimes.filter(isRegimeKey) : null;
}

/* ─────────────────────────────── Weekly reflection ─────────────────────────────── */

export const REFLECTION_QUESTIONS = ["recognize", "playbooks", "risk"] as const;
export type ReflectionQuestion = (typeof REFLECTION_QUESTIONS)[number];
/** regime → question → the trader's answer (free text). */
export type ReflectionAnswers = Partial<Record<RegimeKey, Partial<Record<ReflectionQuestion, string>>>>;

export type Reflection = { trader: string; week: string; answers: ReflectionAnswers; prefilledFrom: string | null; updatedAt: string | null };

/** Keeps known regimes / questions and non-empty trimmed strings only. */
export function cleanAnswers(raw: unknown): ReflectionAnswers {
  const out: ReflectionAnswers = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of REGIME_KEYS) {
    const row = (raw as Record<string, unknown>)[k];
    if (!row || typeof row !== "object") continue;
    const q: Partial<Record<ReflectionQuestion, string>> = {};
    for (const x of REFLECTION_QUESTIONS) {
      const v = (row as Record<string, unknown>)[x];
      if (typeof v === "string" && v.trim()) q[x] = v.trim();
    }
    if (Object.keys(q).length) out[k] = q;
  }
  return out;
}

/** The week's answers; without a row of its own, the latest earlier week's answers (prefill, `prefilledFrom` = that week). */
export async function reflection(trader: string, week: string): Promise<Reflection> {
  const { rows } = await pool.query<{ week: string; answers: unknown; updated_at: Date | string }>(
    `SELECT week, answers, updated_at FROM regime_reflections WHERE trader = $1 AND week <= $2 ORDER BY week DESC LIMIT 1`,
    [trader, week],
  );
  const r = rows[0];
  if (!r) return { trader, week, answers: {}, prefilledFrom: null, updatedAt: null };
  const own = r.week === week;
  return { trader, week, answers: cleanAnswers(r.answers), prefilledFrom: own ? null : r.week, updatedAt: own ? iso(r.updated_at) : null };
}

export async function saveReflection(trader: string, week: string, answers: ReflectionAnswers): Promise<Reflection> {
  const clean = cleanAnswers(answers);
  const { rows } = await pool.query<{ updated_at: Date | string }>(
    `INSERT INTO regime_reflections (trader, week, answers) VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (trader, week) DO UPDATE SET answers = EXCLUDED.answers, updated_at = now()
     RETURNING updated_at`,
    [trader, week, JSON.stringify(clean)],
  );
  return { trader, week, answers: clean, prefilledFrom: null, updatedAt: iso(rows[0]!.updated_at) };
}
