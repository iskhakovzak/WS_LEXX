/**
 * «Ассистент WS» — storage (migration 0260): the per-user conversation, the daily token usage behind the budgets, and
 * the audit of every call. Plus the desk settings snapshot and the budget decision (pure).
 */
import { pool } from "@workspace/db";
import { setting } from "../settings/registry";
import { logger } from "../logger";
import { isAssistantModel, unitWeight, type AssistantModel, type RouteSettings, type Tier, type Usage } from "./models";
import type { Draft } from "./drafts";

const isTier = (v: unknown): v is Tier => v === "standard" || v === "boost" || v === "deep";

// ─── settings ───────────────────────────────────────────────────────────────

export type AssistantSettings = RouteSettings & {
  enabled: boolean;
  juniorsEnabled: boolean;
  dailyUnits: number;
  auditBodies: boolean;
};

export function assistantSettings(): AssistantSettings {
  const dm = setting("assistant.defaultModel");
  const sm = setting("assistant.smartModel");
  const am = setting("assistant.advisorModel");
  return {
    enabled: setting("assistant.enabled"),
    defaultModel: isAssistantModel(dm) ? dm : "claude-haiku-5-5",
    smartModel: isAssistantModel(sm) ? sm : "claude-sonnet-5-5",
    autoEscalate: setting("assistant.autoEscalate"),
    advisorEnabled: setting("assistant.advisorEnabled"),
    advisorModel: isAssistantModel(am) ? am : "claude-sonnet-5-5",
    multiplier: setting("assistant.boostMultiplier"),
    juniorsEnabled: setting("assistant.juniorsEnabled"),
    dailyUnits: setting("assistant.dailyUnits"),
    auditBodies: setting("assistant.auditBodies"),
  };
}

// ─── budgets ────────────────────────────────────────────────────────────────

/** Per-model budget tokens of one day. */
export type DayUsage = Partial<Record<AssistantModel, number>>;

/** Budget tokens used today per model (input + cache writes + output). */
export async function usageToday(user: string, day: string): Promise<DayUsage> {
  const { rows } = await pool.query<{ model: string; tokens: string }>(
    `SELECT model, (input_tokens + cache_write_tokens + output_tokens)::text AS tokens
       FROM ai_assistant_usage WHERE user_name = $1 AND day = $2`,
    [user, day],
  );
  const out: DayUsage = {};
  for (const r of rows) if (isAssistantModel(r.model)) out[r.model] = Number(r.tokens) || 0;
  return out;
}

/** The member-facing budget: units used / limit today, whether any is left, and the share left (0..1). */
export type BudgetState = { used: number; limit: number; left: boolean; leftShare: number; multiplier: number };

/** Units used today: each model's budget tokens times its weight (the default model 1x, any other the multiplier). */
export function unitsUsed(used: DayUsage, s: Pick<AssistantSettings, "defaultModel" | "multiplier">): number {
  let n = 0;
  for (const [m, tokens] of Object.entries(used) as [AssistantModel, number | undefined][]) n += (tokens ?? 0) * unitWeight(m, s);
  return n;
}

/**
 * Today's unified budget. `extra` = units already spent in the running turn (not recorded yet). limit 0 = the
 * assistant is off for everyone until the admin sets a budget.
 */
export function budgetOf(s: AssistantSettings, used: DayUsage, extra = 0): BudgetState {
  const u = Math.round(unitsUsed(used, s) + extra);
  const limit = Math.max(0, s.dailyUnits);
  return { used: u, limit, left: u < limit, leftShare: limit > 0 ? Math.max(0, Math.min(1, (limit - u) / limit)) : 0, multiplier: Math.max(1, s.multiplier) };
}

// ─── conversation ───────────────────────────────────────────────────────────

/** A history row as the web gets it: the tier of an answer, never its model. */
export type StoredMessage = { id: number; role: "user" | "assistant"; content: string; tier: Tier | null; drafts: Draft[] | null; tools: string[]; createdAt: string };

export async function loadHistory(user: string, limit = 60): Promise<StoredMessage[]> {
  const { rows } = await pool.query<{ id: string; role: "user" | "assistant"; content: string; tier: string | null; drafts: Draft[] | null; tools: string[] | null; created_at: Date }>(
    `SELECT id, role, content, tier, drafts, tools, created_at FROM ai_assistant_messages
      WHERE user_name = $1 AND cleared_at IS NULL ORDER BY id DESC LIMIT $2`,
    [user, limit],
  );
  return rows.reverse().map((r) => ({
    id: Number(r.id), role: r.role, content: r.content, tier: isTier(r.tier) ? r.tier : null, drafts: r.drafts ?? null, tools: r.tools ?? [],
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function saveMessage(user: string, m: { role: "user" | "assistant"; content: string; model?: string | null; tier?: Tier | null; drafts?: Draft[] | null; tools?: string[]; page?: string | null }): Promise<number | null> {
  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO ai_assistant_messages (user_name, role, content, model, tier, drafts, tools, page) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8) RETURNING id`,
      [user, m.role, m.content.slice(0, 40_000), m.model ?? null, m.tier ?? null, m.drafts?.length ? JSON.stringify(m.drafts) : null, m.tools ?? [], m.page?.slice(0, 300) ?? null],
    );
    return rows[0] ? Number(rows[0].id) : null;
  } catch (err) {
    logger.warn({ err }, "assistant: could not store a message");
    return null;
  }
}

/** «Очистить»: soft clear of the caller's thread (cleared rows are never read again). */
export async function clearHistory(user: string): Promise<number> {
  const r = await pool.query(`UPDATE ai_assistant_messages SET cleared_at = now() WHERE user_name = $1 AND cleared_at IS NULL`, [user]);
  return r.rowCount ?? 0;
}

// ─── usage + audit ──────────────────────────────────────────────────────────

export async function recordUsage(user: string, day: string, usage: Partial<Record<AssistantModel, Usage>>, costs: Partial<Record<AssistantModel, number>>): Promise<void> {
  for (const [model, u] of Object.entries(usage) as [AssistantModel, Usage][]) {
    await pool.query(
      `INSERT INTO ai_assistant_usage (user_name, day, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, requests, cost_usd, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, now())
       ON CONFLICT (user_name, day, model) DO UPDATE SET
         input_tokens = ai_assistant_usage.input_tokens + EXCLUDED.input_tokens,
         output_tokens = ai_assistant_usage.output_tokens + EXCLUDED.output_tokens,
         cache_read_tokens = ai_assistant_usage.cache_read_tokens + EXCLUDED.cache_read_tokens,
         cache_write_tokens = ai_assistant_usage.cache_write_tokens + EXCLUDED.cache_write_tokens,
         requests = ai_assistant_usage.requests + 1,
         cost_usd = ai_assistant_usage.cost_usd + EXCLUDED.cost_usd,
         updated_at = now()`,
      [user, day, model, u.input, u.output, u.cacheRead, u.cacheWrite, costs[model] ?? 0],
    ).catch((err) => logger.warn({ err }, "assistant: could not record usage"));
  }
}

// ─── admin usage stats ─────────────────────────────────────────────────────

export type UsageTotals = { requests: number; input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number; units: number; cacheHitRatio: number | null };
export type UsageStats = { from: string; to: string; users: number; total: UsageTotals; days: (UsageTotals & { day: string })[]; byModel: (UsageTotals & { model: string })[] };

const EMPTY_TOTALS: UsageTotals = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, units: 0, cacheHitRatio: null };

/** Share of prompt tokens served from the cache: cache reads / (uncached input + cache reads + cache writes). */
export function cacheHitRatio(t: Pick<UsageTotals, "input" | "cacheRead" | "cacheWrite">): number | null {
  const prompt = t.input + t.cacheRead + t.cacheWrite;
  return prompt > 0 ? t.cacheRead / prompt : null;
}

type StatRow = { day: string; model: string; users: string; requests: string; input: string; output: string; cache_read: string; cache_write: string; cost: string };

/** Desk-wide assistant usage between two NY days (admin: tokens, cost, units at today's weights, cache hit ratio). */
export async function usageStats(from: string, to: string, s: Pick<AssistantSettings, "defaultModel" | "multiplier">): Promise<UsageStats> {
  const [{ rows }, people] = await Promise.all([
    pool.query<StatRow>(
      `SELECT day, model, COUNT(DISTINCT user_name)::text AS users, SUM(requests)::text AS requests, SUM(input_tokens)::text AS input,
              SUM(output_tokens)::text AS output, SUM(cache_read_tokens)::text AS cache_read, SUM(cache_write_tokens)::text AS cache_write,
              SUM(cost_usd)::text AS cost
         FROM ai_assistant_usage WHERE day BETWEEN $1 AND $2 GROUP BY day, model ORDER BY day`,
      [from, to],
    ),
    pool.query<{ n: string }>(`SELECT COUNT(DISTINCT user_name)::text AS n FROM ai_assistant_usage WHERE day BETWEEN $1 AND $2`, [from, to]),
  ]);
  const add = (a: UsageTotals, r: StatRow): UsageTotals => {
    const u = { input: Number(r.input) || 0, output: Number(r.output) || 0, cacheRead: Number(r.cache_read) || 0, cacheWrite: Number(r.cache_write) || 0 };
    const weight = isAssistantModel(r.model) ? unitWeight(r.model, s) : 1;
    const next = {
      requests: a.requests + (Number(r.requests) || 0), input: a.input + u.input, output: a.output + u.output, cacheRead: a.cacheRead + u.cacheRead,
      cacheWrite: a.cacheWrite + u.cacheWrite, costUsd: a.costUsd + (Number(r.cost) || 0), units: a.units + (u.input + u.cacheWrite + u.output) * weight, cacheHitRatio: null,
    };
    return { ...next, cacheHitRatio: cacheHitRatio(next) };
  };
  const days = new Map<string, UsageTotals>();
  const models = new Map<string, UsageTotals>();
  let total = EMPTY_TOTALS;
  for (const r of rows) {
    days.set(r.day, add(days.get(r.day) ?? EMPTY_TOTALS, r));
    models.set(r.model, add(models.get(r.model) ?? EMPTY_TOTALS, r));
    total = add(total, r);
  }
  return {
    from, to, users: Number(people.rows[0]?.n) || 0, total,
    days: [...days].map(([day, t]) => ({ day, ...t })),
    byModel: [...models].map(([model, t]) => ({ model, ...t })),
  };
}

export type AuditRow = {
  user: string; mode: "chat" | "assist" | "review" | "batch" | "mentor" | "mentor_batch"; models: string[]; reason: string; usage: Usage; costUsd: number; tools: string[]; drafts: number;
  status: "ok" | "error" | "aborted" | "refused"; errorCode?: string | null; page?: string | null; durationMs: number;
  /** Bodies are written only when the desk setting assistant.auditBodies is on. */
  userMessage?: string | null; assistantMessage?: string | null;
};

/** One audit row per call: who, models, tokens, tools, outcome — no message bodies unless the setting allows it. */
export async function writeAudit(a: AuditRow, keepBodies: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO ai_assistant_audit (user_name, mode, models, route_reason, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
                                     cost_usd, tools, drafts, status, error_code, page, duration_ms, user_message, assistant_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [a.user, a.mode, a.models, a.reason, a.usage.input, a.usage.output, a.usage.cacheRead, a.usage.cacheWrite, a.costUsd, a.tools, a.drafts,
      a.status, a.errorCode ?? null, a.page?.slice(0, 300) ?? null, a.durationMs,
      keepBodies ? (a.userMessage ?? null) : null, keepBodies ? (a.assistantMessage ?? null) : null],
  ).catch((err) => logger.warn({ err }, "assistant: could not write the audit row"));
}
