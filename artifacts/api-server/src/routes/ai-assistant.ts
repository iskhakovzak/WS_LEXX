/**
 * Assistant — the site's own AI assistant (docs/AI_ASSISTANT.md; engine lib/assistant/*).
 *
 *   GET    /ai/assistant/status       configured / on / open for me; my budget today (units, share left, multiplier)
 *   GET    /ai/assistant/history      my conversation (newest last, cleared rows never come back)
 *   DELETE /ai/assistant/history      «Clear» — soft clear of my conversation
 *   POST   /ai/assistant/chat         { message, boost?, intent?, context? } → text/event-stream (lib/assistant/sse.ts)
 *   POST   /ai/assistant/assist       { action, field, text, context? } → { suggestion, tier, units, refused } («Help»)
 *   GET    /ai/assistant/usage-stats  admin (settings.manage): desk-wide tokens, cost, units, cache hit ratio per day
 *
 * No member-facing answer names a model: routes map a route to a tier (standard / boost / deep). Only the admin's
 * usage stats (a technical view) list models.
 * Rights: capability assistant.use (every member by default; the roles matrix may close it for traders or curators),
 * the desk switch assistant.enabled (403 AI_ASSISTANT_OFF), juniors via assistant.juniorsEnabled (403
 * AI_ASSISTANT_STAGE; staff have no stage). No key (AI_INTEGRATIONS_ANTHROPIC_API_KEY) and no dev mock → 503
 * AI_NOT_CONFIGURED. Per-user request rate (lib/rateLimits assistantLimiter, 429 RATE_LIMITED) and ONE daily budget in
 * units (429 AI_BUDGET_EXCEEDED): default-model tokens 1x, boost / escalation / advisor tokens x assistant.boostMultiplier.
 * Every call is audited (who, models, tokens, tools; bodies only with assistant.auditBodies). The assistant reads
 * through the app's own API as the caller and never writes: drafts are cards the person saves through the usual forms.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { Anthropic } from "@workspace/integrations-anthropic-ai";
import { AppError, errorMessage, route, type ErrorCode } from "../lib/http";
import { can, type Actor } from "../lib/permissions";
import { isStaffRole } from "../lib/auth";
import { viewerStage, type AccessStage } from "../lib/access/stage";
import { addDays, nyDate } from "../lib/tradingDate";
import { logger } from "../lib/logger";
import { assistantLimiter } from "../lib/rateLimits";
import { langOf, type Lang } from "../i18n";
import { assistantT } from "../i18n/ns";
import { assistantClient, type AssistantClient } from "../lib/assistant/client";
import { apiCallerFor } from "../lib/assistant/internalApi";
import { buildUserTurn, historyChars, historyMessages, PageContextSchema, type PageContext } from "../lib/assistant/context";
import { runTurn, type EngineResult } from "../lib/assistant/engine";
import { openSse, type SseWriter } from "../lib/assistant/sse";
import { HEAVY_INTENTS, ZERO_USAGE, addUsage, initialRoute, tierOf, type Usage } from "../lib/assistant/models";
import {
  assistantSettings, budgetOf, clearHistory, loadHistory, recordUsage, saveMessage, usageStats, usageToday, writeAudit, type AssistantSettings, type DayUsage,
} from "../lib/assistant/store";
import type { ToolContext } from "../lib/assistant/tools";

const router: IRouter = Router();

type Gate = { s: AssistantSettings; staff: boolean; stage: AccessStage | null; blocked: ErrorCode | null };

/** Desk switch and stage, without throwing (status uses it as is; chat / assist throw the code). */
export async function gateOf(actor: Actor): Promise<Gate> {
  const s = assistantSettings();
  const staff = isStaffRole(actor.role);
  const stage = staff ? null : await viewerStage(actor.name);
  const blocked: ErrorCode | null = !s.enabled ? "AI_ASSISTANT_OFF" : !staff && !s.juniorsEnabled && stage === "junior" ? "AI_ASSISTANT_STAGE" : null;
  return { s, staff, stage, blocked };
}

export type Ready = Gate & { client: AssistantClient; today: string; used: DayUsage };

/** Everything that must hold before a model call; throws the matching AppError (the AI reviews use it too). */
export async function ready(actor: Actor): Promise<Ready> {
  const g = await gateOf(actor);
  if (g.blocked) throw new AppError(g.blocked);
  const client = assistantClient();
  if (!client) throw new AppError("AI_NOT_CONFIGURED");
  const today = nyDate();
  const used = await usageToday(actor.name, today);
  const b = budgetOf(g.s, used);
  if (!b.left) throw new AppError("AI_BUDGET_EXCEEDED", undefined, undefined, { used: b.used, limit: b.limit });
  return { ...g, client, today, used };
}

function toolContext(req: Request, actor: Actor, lang: Lang, today: string, staff: boolean, signal: AbortSignal): ToolContext {
  return { api: apiCallerFor(req, lang, signal), req, lang, actor: { name: actor.name, staff, admin: actor.role === "admin" }, today };
}

const totalUsage = (r: EngineResult): Usage => Object.values(r.usage).reduce<Usage>((a, u) => addUsage(a, u ?? ZERO_USAGE), ZERO_USAGE);

/** Provider failures → one stable code (the details go to the log, never the key). */
export function providerErrorCode(err: unknown): ErrorCode {
  if (err instanceof Anthropic.APIError) {
    logger.warn({ status: err.status, type: err.name }, "assistant: model provider error");
    return "AI_UNAVAILABLE";
  }
  logger.error({ err }, "assistant: turn failed");
  return "INTERNAL";
}

// ─── status / history ──────────────────────────────────────────────────────

router.get("/ai/assistant/status", route({ cap: "assistant.use" }, async ({ req, actor }) => {
  const g = await gateOf(actor);
  const client = assistantClient();
  const used = await usageToday(actor.name, nyDate());
  return {
    configured: !!client,
    mock: client?.kind === "mock",
    enabled: g.s.enabled,
    allowed: !g.blocked && !!client,
    blocked: g.blocked ?? (client ? null : "AI_NOT_CONFIGURED"),
    canConfigure: await can(req, "settings.manage"),
    budget: budgetOf(g.s, used),
    staff: g.staff,
  };
}));

router.get("/ai/assistant/history", route({ cap: "assistant.use" }, async ({ actor }) => ({ messages: await loadHistory(actor.name) })));

router.delete("/ai/assistant/history", route({ cap: "assistant.use" }, async ({ actor }) => ({ cleared: await clearHistory(actor.name) })));

router.get("/ai/assistant/usage-stats", route({
  cap: "settings.manage",
  query: z.object({ days: z.coerce.number().int().min(1).max(90).optional() }).passthrough(),
}, async ({ query }) => {
  const to = nyDate();
  return usageStats(addDays(to, -((query.days ?? 14) - 1)), to, assistantSettings());
}));

// ─── chat (SSE) ────────────────────────────────────────────────────────────

const ChatBody = z.object({
  message: z.string().trim().min(1).max(8000),
  boost: z.boolean().optional(),
  /** Older web builds: the same switch under its first name. */
  smart: z.boolean().optional(),
  intent: z.enum([...HEAVY_INTENTS, "chat", "help"]).optional(),
  context: PageContextSchema.optional(),
});

function abortOnClose(res: Response): AbortController {
  const ctl = new AbortController();
  res.on("close", () => { if (!res.writableFinished) ctl.abort(); });
  return ctl;
}

router.post("/ai/assistant/chat", assistantLimiter, route({ cap: "assistant.use", body: ChatBody }, async ({ req, res, actor, body }) => {
  const r = await ready(actor);
  const lang = langOf(req);
  const started = Date.now();
  const rows = await loadHistory(actor.name, 24);
  const history = historyMessages(rows);
  const page: PageContext | null = body.context ?? null;
  const boost = !!(body.boost ?? body.smart);
  const userTurn = buildUserTurn({ today: r.today, lang, asker: { name: actor.name, role: actor.role, stage: r.stage }, page, intent: body.intent ?? null, message: body.message });
  const budgetLeft = (extra: number) => budgetOf(r.s, r.used, extra).left;
  const first = initialRoute({ settings: r.s, mode: "chat", boost, intent: body.intent ?? null, contextChars: historyChars(history) + userTurn.length, budgetLeft: budgetLeft(0) });

  const ctl = abortOnClose(res);
  const sse: SseWriter = openSse(res);
  sse.send({ event: "meta", data: { tier: tierOf(first), reason: first.reason, boost } });
  await saveMessage(actor.name, { role: "user", content: body.message, page: page?.route ?? null });

  let result: EngineResult | null = null;
  let errorCode: ErrorCode | null = null;
  try {
    result = await runTurn({
      client: r.client, tools: toolContext(req, actor, lang, r.today, r.staff, ctl.signal), settings: r.s, route: first, history, userTurn,
      emit: (e) => sse.send(e), signal: ctl.signal, budgetLeft,
    });
  } catch (err) {
    errorCode = providerErrorCode(err);
  }
  const status = errorCode ? "error" : result!.status;
  const text = result?.text ?? "";
  const drafts = result?.drafts ?? [];
  const finalRoute = result?.route ?? first;
  const tier = tierOf(finalRoute);
  const messageId = text.trim() || drafts.length
    ? await saveMessage(actor.name, { role: "assistant", content: text, model: finalRoute.model, tier, drafts, tools: result?.tools ?? [], page: page?.route ?? null })
    : null;
  if (result) await recordUsage(actor.name, r.today, result.usage, result.costByModel);
  await writeAudit({
    user: actor.name, mode: "chat", models: result?.models ?? [first.model], reason: finalRoute.reason,
    usage: result ? totalUsage(result) : ZERO_USAGE, costUsd: result?.costUsd ?? 0, tools: result?.tools ?? [], drafts: drafts.length,
    status, errorCode: errorCode ?? result?.errorCode ?? null, page: page?.route ?? null, durationMs: Date.now() - started,
    userMessage: body.message, assistantMessage: text,
  }, r.s.auditBodies);

  if (errorCode || result?.status === "error") {
    const code = errorCode ?? "AI_UNAVAILABLE";
    sse.send({ event: "error", data: { code, message: errorMessage(code, lang) } });
  } else if (result && result.status !== "aborted") {
    sse.send({ event: "done", data: { messageId, tier, units: Math.round(result.units), stop: result.status === "refused" ? "refusal" : result.stop } });
  }
  sse.close();
}));

// ─── «Help» (inline help in text fields) ──────────────────────────────────

const AssistBody = z.object({
  action: z.enum(["improve", "structure", "fill"]),
  field: z.enum(["playbook", "plan", "eod", "journal", "note"]),
  text: z.string().max(20_000).default(""),
  context: PageContextSchema.optional(),
});

router.post("/ai/assistant/assist", assistantLimiter, route({ cap: "assistant.use", body: AssistBody }, async ({ req, res, actor, body }) => {
  const r = await ready(actor);
  const lang = langOf(req);
  const t = assistantT.tFor(lang);
  const started = Date.now();
  const page = body.context ?? null;
  const message = [t(`assist.${body.action}`), t("assist.only"), "", `<text field="${body.field}">`, body.text, "</text>"].join("\n");
  const userTurn = buildUserTurn({ today: r.today, lang, asker: { name: actor.name, role: actor.role, stage: r.stage }, page, intent: `assist_${body.action}`, message });
  const budgetLeft = (extra: number) => budgetOf(r.s, r.used, extra).left;
  const first = initialRoute({ settings: r.s, mode: "assist", boost: false, contextChars: userTurn.length, budgetLeft: budgetLeft(0) });
  const ctl = abortOnClose(res);
  let result: EngineResult | null = null;
  let errorCode: ErrorCode | null = null;
  try {
    result = await runTurn({
      client: r.client, tools: toolContext(req, actor, lang, r.today, r.staff, ctl.signal), settings: r.s, route: first, history: [], userTurn,
      emit: () => undefined, signal: ctl.signal, budgetLeft, maxSteps: body.action === "fill" ? 5 : 2,
    });
  } catch (err) {
    errorCode = providerErrorCode(err);
  }
  if (result) await recordUsage(actor.name, r.today, result.usage, result.costByModel);
  await writeAudit({
    user: actor.name, mode: "assist", models: result?.models ?? [first.model], reason: first.reason, usage: result ? totalUsage(result) : ZERO_USAGE,
    costUsd: result?.costUsd ?? 0, tools: result?.tools ?? [], drafts: 0, status: errorCode ? "error" : result!.status, errorCode,
    page: page?.route ?? null, durationMs: Date.now() - started, userMessage: body.text, assistantMessage: result?.text ?? null,
  }, r.s.auditBodies);
  if (errorCode) throw new AppError(errorCode);
  if (!result || result.status === "aborted") return undefined;
  return { suggestion: result.text.trim(), tier: tierOf(result.route), units: Math.round(result.units), refused: result.status === "refused" };
}));

export default router;
