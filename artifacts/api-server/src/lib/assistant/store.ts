/**
 * «Ассистент WS» — storage (migration 0260): the per-user conversation, the daily token usage behind the budgets, and
 * the audit of every call. Plus the desk settings snapshot and the budget decision (pure).
 */
import { pool } from "@workspace/db";
import { setting } from "../settings/registry";
import { logger } from "../logger";
import { isAssistantModel, type AssistantModel, type ModelClass, type RouteSettings, type Usage } from "./models";
import type { Draft } from "./drafts";

// ─── settings ───────────────────────────────────────────────────────────────

export type AssistantSettings = RouteSettings & {
  enabled: boolean;
  juniorsEnabled: boolean;
  dailyTokensDefault: number;
  dailyTokensSmart: number;
  auditBodies: boolean;
};

export function assistantSettings(): AssistantSettings {
  const dm = setting("assistant.defaultModel");
  const sm = setting("assistant.smartModel");
  return {
    enabled: setting("assistant.enabled"),
    defaultModel: isAssistantModel(dm) ? dm : "claude-haiku-5-5",
    smartModel: isAssistantModel(sm) ? sm : "claude-sonnet-5-5",
    autoEscalate: setting("assistant.autoEscalate"),
    juniorsEnabled: setting("assistant.juniorsEnabled"),
    dailyTokensDefault: setting("assistant.dailyTokensDefault"),
    dailyTokensSmart: setting("assistant.dailyTokensSmart"),
    auditBodies: setting("assistant.auditBodies"),
  };
}

// ─── budgets ────────────────────────────────────────────────────────────────

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

export type BudgetState = { used: number; limit: number; left: boolean };

/**
 * Usage of a model class today. The budgets are per class: the default model's budget counts the tokens of whatever
 * model is the default now, the escalation budget those of the escalation model (when both settings name the same
 * model, it draws from the default budget only). limit 0 = that class is off.
 */
export function budgetOf(cls: ModelClass, s: AssistantSettings, used: DayUsage, extra = 0): BudgetState {
  const model = cls === "smart" ? s.smartModel : s.defaultModel;
  const limit = cls === "smart" ? s.dailyTokensSmart : s.dailyTokensDefault;
  const u = (used[model] ?? 0) + extra;
  return { used: u, limit, left: u < limit };
}

// ─── conversation ───────────────────────────────────────────────────────────

export type StoredMessage = { id: number; role: "user" | "assistant"; content: string; model: string | null; drafts: Draft[] | null; tools: string[]; createdAt: string };

export async function loadHistory(user: string, limit = 60): Promise<StoredMessage[]> {
  const { rows } = await pool.query<{ id: string; role: "user" | "assistant"; content: string; model: string | null; drafts: Draft[] | null; tools: string[] | null; created_at: Date }>(
    `SELECT id, role, content, model, drafts, tools, created_at FROM ai_assistant_messages
      WHERE user_name = $1 AND cleared_at IS NULL ORDER BY id DESC LIMIT $2`,
    [user, limit],
  );
  return rows.reverse().map((r) => ({
    id: Number(r.id), role: r.role, content: r.content, model: r.model, drafts: r.drafts ?? null, tools: r.tools ?? [],
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function saveMessage(user: string, m: { role: "user" | "assistant"; content: string; model?: string | null; drafts?: Draft[] | null; tools?: string[]; page?: string | null }): Promise<number | null> {
  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO ai_assistant_messages (user_name, role, content, model, drafts, tools, page) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7) RETURNING id`,
      [user, m.role, m.content.slice(0, 40_000), m.model ?? null, m.drafts?.length ? JSON.stringify(m.drafts) : null, m.tools ?? [], m.page?.slice(0, 300) ?? null],
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

export type AuditRow = {
  user: string; mode: "chat" | "assist"; models: string[]; reason: string; usage: Usage; costUsd: number; tools: string[]; drafts: number;
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
