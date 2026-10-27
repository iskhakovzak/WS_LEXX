/**
 * Optional scheduled pushes (setting mentor.pushesEnabled, off by default): the pre-market brief (mentor.briefTime)
 * and the post-session debrief (mentor.debriefTime) written ahead for each active trader through the Message Batches
 * API at half price, so the mentor opens with them ready and the trader gets one in-app notice. Job mentor.pushes
 * (every 10 minutes on weekdays while the setting is on):
 *   1. poll  every pending batch (ids in mentor_digests.batch_id; a restart resumes): ended → validate each answer with
 *            the live schema (no retry) → apply it like a live digest → store → opener in the thread → notice → audit
 *            (mode mentor_batch, cost at the batch price); a batch unreadable after 25 h → its digests failed (the
 *            trader's next open generates the digest live)
 *   2. submit inside each window (2 h after the time): traders without that digest today — brief: traded in the last
 *            10 weekdays; debrief: traded today — within the desk cap mentor.pushDailyUnits (estimated per request).
 * Pushes never spend a trader's personal budget. No key → nothing is submitted or polled.
 */
import { pool } from "@workspace/db";
import type { JobContext } from "../../jobs/registry";
import { logger } from "../logger";
import { setting } from "../settings/registry";
import { timeToMinutes } from "../settings/validate";
import { addDays, nyDate, nyMinutes } from "../tradingDate";
import { localeOfUser } from "../../i18n";
import { insertNotification } from "../notifyUtils";
import { viewerStage } from "../access/stage";
import { batchClient, type BatchClient, type BatchRequest } from "../assistant/batchClient";
import { assistantSettings, writeAudit } from "../assistant/store";
import { isAssistantModel } from "../assistant/models";
import { textOf } from "../assistant/review/run";
import { BATCH_DISCOUNT } from "../assistant/batch/job";
import { gatherFacts } from "./facts";
import { addResponseUsage, mentorParams, mentorPlan, totalUsage, type MentorCall } from "./run";
import { parseMentor, type Brief, type Debrief, type RhythmKind } from "./schema";
import { applyRhythm, openerOf, periodOf, rhythmRequest } from "./service";
import { digestExists, failDigests, pendingBatches, pendingOf, saveMessage, setDigestBatch, upsertDigest } from "./store";

/** Budget units one push request is assumed to take when fitting the desk cap (a brief / debrief is ~3–8K). */
export const UNITS_PER_PUSH = 8_000;
const WINDOW_MIN = 120;
const GIVE_UP_MS = 25 * 3_600_000;

/** Push kinds whose window is open at NY minute `now` (pure). */
export function dueKinds(now: number, briefMin: number, debriefMin: number): Extract<RhythmKind, "brief" | "debrief">[] {
  const out: Extract<RhythmKind, "brief" | "debrief">[] = [];
  if (now >= briefMin && now < briefMin + WINDOW_MIN) out.push("brief");
  if (now >= debriefMin && now < debriefMin + WINDOW_MIN) out.push("debrief");
  return out;
}

async function targets(kind: "brief" | "debrief", today: string): Promise<string[]> {
  const from = kind === "brief" ? addDays(today, -14) : today;
  const { rows } = await pool.query<{ name: string }>(
    `SELECT u.name FROM users u
      WHERE u.active = true AND u.role = 'trader' AND COALESCE(u.banned, false) = false
        AND EXISTS (SELECT 1 FROM trades t WHERE t.trader = u.name AND t.deleted_at IS NULL AND LEFT(t.date, 10) BETWEEN $1 AND $2)
      ORDER BY u.name`,
    [from, today],
  );
  const done = await digestExists(kind, today);
  const s = assistantSettings();
  const out: string[] = [];
  for (const { name } of rows) {
    if (done.has(name)) continue;
    if (!s.juniorsEnabled && (await viewerStage(name)) === "junior") continue;
    out.push(name);
  }
  return out;
}

async function usedToday(today: string): Promise<number> {
  const { rows } = await pool.query<{ units: string; pending: string }>(
    `SELECT COALESCE(SUM(units), 0)::text AS units, COUNT(*) FILTER (WHERE status = 'pending')::text AS pending
       FROM mentor_digests WHERE source = 'batch' AND period = $1`,
    [today],
  );
  return (Number(rows[0]?.units) || 0) + (Number(rows[0]?.pending) || 0) * UNITS_PER_PUSH;
}

async function submit(client: BatchClient, kind: "brief" | "debrief", today: string): Promise<number> {
  const cap = setting("mentor.pushDailyUnits");
  const room = Math.floor((cap - (await usedToday(today))) / UNITS_PER_PUSH);
  if (room <= 0) return 0;
  const names = (await targets(kind, today)).slice(0, room);
  if (!names.length) return 0;
  const s = assistantSettings();
  const plan = mentorPlan(kind, s);
  const requests: BatchRequest[] = [];
  const ids: number[] = [];
  for (const trader of names) {
    try {
      const lang = await localeOfUser(trader);
      const req = rhythmRequest(kind, await gatherFacts(trader, today), lang, false);
      const row = await upsertDigest({ trader, kind, period: periodOf(kind, today), lang, inputHash: req.hash, content: null, status: "pending", source: "batch", deep: false, units: 0, costUsd: 0 });
      ids.push(row.id);
      requests.push({ custom_id: `md_${row.id}`, params: mentorParams(kind, plan, req.system, req.messages, { cacheTtl: "1h" }) });
    } catch (err) {
      logger.warn({ err, kind }, "mentor push: could not prepare one trader");
    }
  }
  if (!requests.length) return 0;
  try {
    const batch = await client.create(requests);
    await setDigestBatch(ids, batch.id);
  } catch (err) {
    await failDigests(ids);
    throw err;
  }
  return requests.length;
}

async function poll(client: BatchClient, batchId: string): Promise<number> {
  const rows = await pendingOf(batchId);
  if (!rows.length) return 0;
  let info;
  try {
    info = await client.retrieve(batchId);
  } catch (err) {
    if (Date.now() - new Date(rows[0]!.createdAt).getTime() > GIVE_UP_MS) await failDigests(rows.map((r) => r.id));
    logger.warn({ err }, "mentor push: batch not readable");
    return 0;
  }
  if (info.processing_status !== "ended") return 0;
  const byId = new Map(rows.map((r) => [`md_${r.id}`, r]));
  const s = assistantSettings();
  let done = 0;
  for await (const line of client.results(batchId)) {
    const row = byId.get(line.custom_id);
    if (!row) continue;
    byId.delete(line.custom_id);
    const kind = row.kind as "brief" | "debrief";
    if (line.result.type !== "succeeded") { await failDigests([row.id]); continue; }
    const message = line.result.message;
    const base = mentorPlan(kind, s);
    const plan = { ...base, model: isAssistantModel(message.model) ? message.model : base.model };
    const acc = { usage: {}, costUsd: 0, costByModel: {}, units: 0, models: [], advisorCalls: 0 } as Omit<MentorCall<"brief">, "value" | "deep">;
    addResponseUsage(acc, plan, message, s, BATCH_DISCOUNT);
    const parsed = parseMentor(kind, textOf(message));
    await writeAudit({
      user: row.trader, mode: "mentor_batch", models: acc.models, reason: kind, usage: totalUsage(acc.usage), costUsd: acc.costUsd,
      tools: acc.advisorCalls ? ["advisor"] : [], drafts: 0, status: parsed.ok ? "ok" : "error", errorCode: parsed.ok ? null : "AI_UNAVAILABLE", page: "/coach", durationMs: 0,
    }, false);
    if (!parsed.ok) { await failDigests([row.id]); continue; }
    const facts = await gatherFacts(row.trader, row.period);
    const content = await applyRhythm(kind, parsed.value as Brief | Debrief, facts);
    await upsertDigest({ trader: row.trader, kind, period: row.period, lang: row.lang, inputHash: row.inputHash, content, status: "ready", source: "batch", deep: !!plan.advisor, units: acc.units, costUsd: acc.costUsd });
    await saveMessage(row.trader, { role: "mentor", kind, content: openerOf(kind, parsed.value as Brief | Debrief) });
    await insertNotification({ userName: row.trader, type: "mentor_ready", params: { variant: kind }, link: "/coach", entityType: "mentor_digest", entityId: row.id });
    done++;
  }
  if (byId.size) await failDigests([...byId.values()].map((r) => r.id));
  return done;
}

export async function runPushes(ctx: Pick<JobContext, "signal" | "trigger">): Promise<{ polled: number; submitted: number; skipped?: string }> {
  const client = batchClient();
  if (!client) return { polled: 0, submitted: 0, skipped: "no_client" };
  let polled = 0;
  for (const id of await pendingBatches()) {
    if (ctx.signal.aborted) break;
    polled += await poll(client, id);
  }
  const s = assistantSettings();
  if (!s.enabled || !setting("mentor.enabled") || !setting("mentor.pushesEnabled")) return { polled, submitted: 0 };
  const kinds = dueKinds(nyMinutes(), timeToMinutes(setting("mentor.briefTime")) ?? 525, timeToMinutes(setting("mentor.debriefTime")) ?? 990);
  let submitted = 0;
  for (const kind of kinds) submitted += await submit(client, kind, nyDate());
  return { polled, submitted };
}
