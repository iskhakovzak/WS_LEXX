/**
 * What the mentor's model call returns — one JSON shape per kind (output_config.format json_schema) and the zod
 * validator every answer passes before it is stored or shown. Numbers in the texts come from the context only (the
 * prompt says so); ids the model may name (setups, commitments) are checked against the context by the service.
 *
 *   brief    before the session: a headline, ≤ 3 short points, the one rule for today, ≤ 3 playbook setups by id
 *   debrief  after the session: what happened vs the plan, one lesson, praise / challenge, the rule for tomorrow
 *            (saved as a commitment), memory notes
 *   weekly   commitments progress with a verdict per commitment, the next focus, an optional new commitment
 *   chat     a short reply, memory notes, an optional commitment the trader agreed to
 * MENTOR_VERSION is part of the digest cache key: bump it whenever a schema, the prompt or the inputs change meaning.
 */
import { z } from "zod";
import { COMMITMENT_KINDS } from "./commitments";
import { extractJson } from "../assistant/review/schema";

export const MENTOR_VERSION = 9; // 9: easyMoney in the debrief; 8: deskPulse in the brief; 7: openWindow in the brief; 6: sessionFlow.offTiming; 5: season in the brief; 4: sessionFlow in the debrief

const MENTOR_KINDS = ["brief", "debrief", "weekly", "chat"] as const;
export type MentorKind = (typeof MENTOR_KINDS)[number];
export type RhythmKind = Exclude<MentorKind, "chat">;

/** Note kinds the mentor may write (the curator's «guidance» and data facts are never written by the model). */
export const MODEL_NOTE_KINDS = ["goal", "strength", "weakness", "discussed", "preference"] as const;

const text = (max: number) => z.string().trim().min(1).max(max);
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const ProposalSchema = z.object({
  kind: z.enum(COMMITMENT_KINDS),
  minutes: z.number().int().nullable(),
  count: z.number().int().nullable(),
  usd: z.number().nullable(),
  time: HHMM.nullable(),
  /** The commitment in the trader's words and language, e.g. «после убытка — 10 минут без входа». */
  text: text(200),
  /** With 3 active commitments: the id of the one this replaces (null otherwise). */
  replaceId: z.number().int().nullable(),
});
export type Proposal = z.infer<typeof ProposalSchema>;

const NoteSchema = z.object({ kind: z.enum(MODEL_NOTE_KINDS), body: text(300) });
export type ModelNote = z.infer<typeof NoteSchema>;

export const BriefSchema = z.object({
  headline: text(200),
  points: z.array(text(280)).max(3),
  ruleToday: text(200),
  setupIds: z.array(z.number().int()).max(3),
});

export const DebriefSchema = z.object({
  summary: text(500),
  vsPlan: text(400),
  lesson: text(300),
  praise: text(300).nullable(),
  challenge: text(300).nullable(),
  ruleTomorrow: ProposalSchema.nullable(),
  notes: z.array(NoteSchema).max(2),
});

export const WeeklySchema = z.object({
  summary: text(600),
  commitments: z.array(z.object({ id: z.number().int(), verdict: z.enum(["keep", "close_achieved", "drop"]), note: text(300) })).max(3),
  nextFocus: text(300),
  newCommitment: ProposalSchema.nullable(),
  notes: z.array(NoteSchema).max(2),
});

export const ChatSchema = z.object({
  reply: text(2000),
  notes: z.array(NoteSchema).max(2),
  commitment: ProposalSchema.nullable(),
});

export type Brief = z.infer<typeof BriefSchema>;
export type Debrief = z.infer<typeof DebriefSchema>;
export type Weekly = z.infer<typeof WeeklySchema>;
export type ChatAnswer = z.infer<typeof ChatSchema>;
export type MentorOutput = { brief: Brief; debrief: Debrief; weekly: Weekly; chat: ChatAnswer };

const SCHEMAS = { brief: BriefSchema, debrief: DebriefSchema, weekly: WeeklySchema, chat: ChatSchema } as const;

// ─── JSON Schema twins for output_config.format (a test checks both accept the same samples) ───────────────────────

const str = (description: string) => ({ type: "string", description });
const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const arr = (items: Record<string, unknown>, description: string) => ({ type: "array", items, description });

const proposalJson = obj({
  kind: { type: "string", enum: [...COMMITMENT_KINDS] },
  minutes: nullable({ type: "integer", description: "pause_after_loss: minutes to wait" }),
  count: nullable({ type: "integer", description: "max_trades: trades per day; stop_after_losses: losses in a row" }),
  usd: nullable({ type: "number", description: "max_daily_loss / max_loss_per_trade: dollars (positive)" }),
  time: nullable(str("no_entry_before / no_entry_after: HH:MM New York time")),
  text: str("The commitment in one short sentence, in the reply language."),
  replaceId: nullable({ type: "integer", description: "When 3 commitments are active: id of the one this replaces." }),
});
const noteJson = obj({ kind: { type: "string", enum: [...MODEL_NOTE_KINDS] }, body: str("One short note worth remembering about the trader.") });

export const JSON_SCHEMAS: Record<MentorKind, Record<string, unknown>> = {
  brief: obj({
    headline: str("One line to open the day."),
    points: arr({ type: "string" }, "At most 3 short points: the regime and the trader's edge in it, the open commitment, a risk to watch."),
    ruleToday: str("The ONE rule for today, concrete."),
    setupIds: arr({ type: "integer" }, "At most 3 ids from playbook.candidates that fit today."),
  }),
  debrief: obj({
    summary: str("What happened today, with the numbers from the context."),
    vsPlan: str("Today against the plan and the commitments."),
    lesson: str("ONE lesson."),
    praise: nullable(str("What deserves praise, concrete.")),
    challenge: nullable(str("What to challenge, concrete.")),
    ruleTomorrow: nullable(proposalJson),
    notes: arr(noteJson, "At most 2 notes for the mentor's memory."),
  }),
  weekly: obj({
    summary: str("The week in numbers from the context."),
    commitments: arr(obj({ id: { type: "integer" }, verdict: { type: "string", enum: ["keep", "close_achieved", "drop"] }, note: str("Praise or challenge with the numbers.") }), "One entry per active commitment."),
    nextFocus: str("The focus for next week."),
    newCommitment: nullable(proposalJson),
    notes: arr(noteJson, "At most 2 notes for the mentor's memory."),
  }),
  chat: obj({
    reply: str("The answer: short, concrete, in the reply language."),
    notes: arr(noteJson, "At most 2 NEW facts worth remembering (goals, preferences, what was agreed). Usually empty."),
    commitment: nullable(proposalJson),
  }),
};

/** Validate a model answer of `kind`. Lists over their caps are trimmed, every other field must fit as is. */
export function parseMentor<K extends MentorKind>(kind: K, raw: string): { ok: true; value: MentorOutput[K] } | { ok: false; issues: string[] } {
  const data = extractJson(raw);
  if (!data || typeof data !== "object") return { ok: false, issues: ["not a JSON object"] };
  const d = { ...(data as Record<string, unknown>) };
  for (const [k, n] of [["points", 3], ["setupIds", 3], ["notes", 2], ["commitments", 3]] as const) if (Array.isArray(d[k])) d[k] = (d[k] as unknown[]).slice(0, n);
  const r = SCHEMAS[kind].safeParse(d);
  return r.success ? { ok: true, value: r.data as MentorOutput[K] } : { ok: false, issues: r.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`) };
}
