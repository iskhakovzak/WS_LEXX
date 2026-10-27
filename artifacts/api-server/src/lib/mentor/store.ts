/**
 * Mentor storage (migration 0271): memory notes, hidden facts, commitments, the thread, the rhythm digests and the
 * escalations. SQL and row shapes only — the rules live in service.ts / commitments.ts / escalation.ts.
 */
import { pool } from "@workspace/db";
import { isCommitmentKind, type CommitmentKind, type CommitmentParams } from "./commitments";
import type { EscalationRule } from "./escalation";
import type { RhythmKind } from "./schema";
import type { Lang } from "../../i18n";

const iso = (v: Date | string | null) => (v == null ? null : new Date(v).toISOString());

// ─── notes ──────────────────────────────────────────────────────────────────

export const NOTE_KINDS = ["goal", "strength", "weakness", "leak", "discussed", "preference", "guidance"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export type NoteSource = "mentor" | "trader" | "curator";
export type Note = { id: number; kind: NoteKind; body: string; source: NoteSource; author: string; createdAt: string; updatedAt: string };

/** «discussed» notes kept per trader (older ones are removed softly when the mentor adds a new one). */
export const MAX_DISCUSSED = 12;
/** Notes of all kinds per trader (a new mentor note beyond it is skipped). */
export const MAX_NOTES = 40;

type NoteRow = { id: string; kind: NoteKind; body: string; source: NoteSource; author: string; created_at: Date; updated_at: Date };
const toNote = (r: NoteRow): Note => ({ id: Number(r.id), kind: r.kind, body: r.body, source: r.source, author: r.author, createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)! });

export async function listNotes(trader: string): Promise<Note[]> {
  const { rows } = await pool.query<NoteRow>(
    `SELECT id, kind, body, source, author, created_at, updated_at FROM mentor_notes WHERE trader = $1 AND deleted_at IS NULL ORDER BY id DESC LIMIT $2`,
    [trader, MAX_NOTES + 10],
  );
  return rows.map(toNote);
}

export async function addNote(trader: string, n: { kind: NoteKind; body: string; source: NoteSource; author: string }): Promise<Note> {
  const { rows } = await pool.query<NoteRow>(
    `INSERT INTO mentor_notes (trader, kind, body, source, author) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, kind, body, source, author, created_at, updated_at`,
    [trader, n.kind, n.body.trim().slice(0, 400), n.source, n.author],
  );
  if (n.kind === "discussed") {
    await pool.query(
      `UPDATE mentor_notes SET deleted_at = now() WHERE id IN (
         SELECT id FROM mentor_notes WHERE trader = $1 AND kind = 'discussed' AND deleted_at IS NULL ORDER BY id DESC OFFSET $2)`,
      [trader, MAX_DISCUSSED],
    );
  }
  return toNote(rows[0]!);
}

export async function noteById(id: number): Promise<(Note & { trader: string }) | null> {
  const { rows } = await pool.query<NoteRow & { trader: string }>(
    `SELECT id, trader, kind, body, source, author, created_at, updated_at FROM mentor_notes WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return rows[0] ? { ...toNote(rows[0]), trader: rows[0].trader } : null;
}

export async function updateNote(id: number, patch: { body?: string; kind?: NoteKind }): Promise<Note | null> {
  const { rows } = await pool.query<NoteRow>(
    `UPDATE mentor_notes SET body = COALESCE($2, body), kind = COALESCE($3, kind), updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL RETURNING id, kind, body, source, author, created_at, updated_at`,
    [id, patch.body?.trim().slice(0, 400) ?? null, patch.kind ?? null],
  );
  return rows[0] ? toNote(rows[0]) : null;
}

export async function deleteNote(id: number): Promise<boolean> {
  const r = await pool.query(`UPDATE mentor_notes SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id]);
  return (r.rowCount ?? 0) > 0;
}

// ─── hidden facts ───────────────────────────────────────────────────────────

export async function hiddenFacts(trader: string): Promise<string[]> {
  const { rows } = await pool.query<{ hidden_facts: string[] }>(`SELECT hidden_facts FROM mentor_profile WHERE trader = $1`, [trader]);
  return rows[0]?.hidden_facts ?? [];
}

export async function setHiddenFacts(trader: string, keys: readonly string[]): Promise<string[]> {
  const clean = [...new Set(keys.map((k) => k.trim()).filter((k) => k && k.length <= 120))].slice(0, 50).sort();
  await pool.query(
    `INSERT INTO mentor_profile (trader, hidden_facts, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (trader) DO UPDATE SET hidden_facts = EXCLUDED.hidden_facts, updated_at = now()`,
    [trader, clean],
  );
  return clean;
}

// ─── commitments ────────────────────────────────────────────────────────────

export type CommitmentStatus = "active" | "achieved" | "dropped" | "replaced";
export type Commitment = {
  id: number; trader: string; kind: CommitmentKind; params: CommitmentParams; text: string | null; source: NoteSource;
  status: CommitmentStatus; startedOn: string; closedOn: string | null; closeNote: string | null; createdBy: string; createdAt: string;
};

type CommitmentRow = {
  id: string; trader: string; kind: string; params: CommitmentParams | null; text: string | null; source: NoteSource; status: CommitmentStatus;
  started_on: string; closed_on: string | null; close_note: string | null; created_by: string; created_at: Date;
};
const COMMITMENT_COLS = `id, trader, kind, params, text, source, status, started_on, closed_on, close_note, created_by, created_at`;
const toCommitment = (r: CommitmentRow): Commitment | null => (isCommitmentKind(r.kind) ? {
  id: Number(r.id), trader: r.trader, kind: r.kind, params: r.params ?? {}, text: r.text, source: r.source, status: r.status,
  startedOn: r.started_on, closedOn: r.closed_on, closeNote: r.close_note, createdBy: r.created_by, createdAt: iso(r.created_at)!,
} : null);

/** Active commitments (oldest first) and the latest closed ones. */
export async function listCommitments(trader: string, closedLimit = 6): Promise<{ active: Commitment[]; closed: Commitment[] }> {
  const { rows } = await pool.query<CommitmentRow>(
    `(SELECT ${COMMITMENT_COLS} FROM mentor_commitments WHERE trader = $1 AND status = 'active' ORDER BY id)
     UNION ALL
     (SELECT ${COMMITMENT_COLS} FROM mentor_commitments WHERE trader = $1 AND status <> 'active' ORDER BY id DESC LIMIT $2)`,
    [trader, closedLimit],
  );
  const all = rows.map(toCommitment).filter((c): c is Commitment => !!c);
  return { active: all.filter((c) => c.status === "active"), closed: all.filter((c) => c.status !== "active") };
}

export async function commitmentById(id: number): Promise<Commitment | null> {
  const { rows } = await pool.query<CommitmentRow>(`SELECT ${COMMITMENT_COLS} FROM mentor_commitments WHERE id = $1`, [id]);
  return rows[0] ? toCommitment(rows[0]) : null;
}

export async function insertCommitment(c: { trader: string; kind: CommitmentKind; params: CommitmentParams; text: string | null; source: NoteSource; startedOn: string; by: string }): Promise<Commitment> {
  const { rows } = await pool.query<CommitmentRow>(
    `INSERT INTO mentor_commitments (trader, kind, params, text, source, started_on, created_by) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
     RETURNING ${COMMITMENT_COLS}`,
    [c.trader, c.kind, JSON.stringify(c.params), c.text?.trim().slice(0, 300) || null, c.source, c.startedOn, c.by],
  );
  return toCommitment(rows[0]!)!;
}

export async function closeCommitment(id: number, status: Exclude<CommitmentStatus, "active">, day: string, note: string | null): Promise<Commitment | null> {
  const { rows } = await pool.query<CommitmentRow>(
    `UPDATE mentor_commitments SET status = $2, closed_on = $3, close_note = $4, updated_at = now()
      WHERE id = $1 AND status = 'active' RETURNING ${COMMITMENT_COLS}`,
    [id, status, day, note?.trim().slice(0, 300) || null],
  );
  return rows[0] ? toCommitment(rows[0]) : null;
}

// ─── thread ─────────────────────────────────────────────────────────────────

export type MessageKind = "chat" | RhythmKind;
export type Message = { id: number; role: "user" | "mentor"; kind: MessageKind; content: string; createdAt: string };

export async function loadThread(trader: string, limit = 40): Promise<Message[]> {
  const { rows } = await pool.query<{ id: string; role: "user" | "mentor"; kind: MessageKind; content: string; created_at: Date }>(
    `SELECT id, role, kind, content, created_at FROM mentor_messages WHERE trader = $1 AND cleared_at IS NULL ORDER BY id DESC LIMIT $2`,
    [trader, limit],
  );
  return rows.reverse().map((r) => ({ id: Number(r.id), role: r.role, kind: r.kind, content: r.content, createdAt: iso(r.created_at)! }));
}

export async function saveMessage(trader: string, m: { role: "user" | "mentor"; kind: MessageKind; content: string }): Promise<Message> {
  const { rows } = await pool.query<{ id: string; created_at: Date }>(
    `INSERT INTO mentor_messages (trader, role, kind, content) VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
    [trader, m.role, m.kind, m.content.slice(0, 8000)],
  );
  return { id: Number(rows[0]!.id), role: m.role, kind: m.kind, content: m.content.slice(0, 8000), createdAt: iso(rows[0]!.created_at)! };
}

export async function clearThread(trader: string): Promise<number> {
  const r = await pool.query(`UPDATE mentor_messages SET cleared_at = now() WHERE trader = $1 AND cleared_at IS NULL`, [trader]);
  return r.rowCount ?? 0;
}

/** NY day of the trader's latest own message to the mentor (silence detection). */
export async function lastUserMessageDay(trader: string): Promise<string | null> {
  const { rows } = await pool.query<{ day: string | null }>(
    `SELECT to_char(MAX(created_at) AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS day FROM mentor_messages WHERE trader = $1 AND role = 'user'`,
    [trader],
  );
  return rows[0]?.day ?? null;
}

// ─── digests ────────────────────────────────────────────────────────────────

export type Digest = {
  id: number; trader: string; kind: RhythmKind; period: string; lang: Lang; inputHash: string; content: unknown; status: "ready" | "pending" | "failed";
  source: "live" | "batch"; deep: boolean; units: number; costUsd: number; createdAt: string;
};
type DigestRow = {
  id: string; trader: string; kind: RhythmKind; period: string; lang: Lang; input_hash: string; content: unknown; status: Digest["status"]; source: Digest["source"];
  deep: boolean; units: string; cost_usd: string; created_at: Date;
};
const DIGEST_COLS = `id, trader, kind, period, lang, input_hash, content, status, source, deep, units, cost_usd, created_at`;
const toDigest = (r: DigestRow): Digest => ({
  id: Number(r.id), trader: r.trader, kind: r.kind, period: r.period, lang: r.lang, inputHash: r.input_hash, content: r.content, status: r.status,
  source: r.source, deep: r.deep, units: Number(r.units) || 0, costUsd: Number(r.cost_usd) || 0, createdAt: iso(r.created_at)!,
});

export async function digestsFor(trader: string, periods: readonly { kind: RhythmKind; period: string }[], lang: Lang): Promise<Digest[]> {
  if (!periods.length) return [];
  const { rows } = await pool.query<DigestRow>(
    `SELECT ${DIGEST_COLS} FROM mentor_digests WHERE trader = $1 AND lang = $2 AND (kind, period) IN (SELECT * FROM unnest($3::text[], $4::text[]))`,
    [trader, lang, periods.map((p) => p.kind), periods.map((p) => p.period)],
  );
  return rows.map(toDigest);
}

export async function upsertDigest(d: { trader: string; kind: RhythmKind; period: string; lang: Lang; inputHash: string; content: unknown; status: Digest["status"]; source: Digest["source"]; batchId?: string | null; deep: boolean; units: number; costUsd: number }): Promise<Digest> {
  const { rows } = await pool.query<DigestRow>(
    `INSERT INTO mentor_digests (trader, kind, period, lang, input_hash, content, status, source, batch_id, deep, units, cost_usd)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (trader, kind, period, lang) DO UPDATE SET input_hash = EXCLUDED.input_hash, content = EXCLUDED.content, status = EXCLUDED.status,
       source = EXCLUDED.source, batch_id = EXCLUDED.batch_id, deep = EXCLUDED.deep, units = mentor_digests.units + EXCLUDED.units,
       cost_usd = mentor_digests.cost_usd + EXCLUDED.cost_usd, updated_at = now()
     RETURNING ${DIGEST_COLS}`,
    [d.trader, d.kind, d.period, d.lang, d.inputHash, d.content == null ? null : JSON.stringify(d.content), d.status, d.source, d.batchId ?? null, d.deep, Math.round(d.units), d.costUsd],
  );
  return toDigest(rows[0]!);
}

export async function pendingBatches(): Promise<string[]> {
  const { rows } = await pool.query<{ batch_id: string }>(`SELECT DISTINCT batch_id FROM mentor_digests WHERE status = 'pending' AND batch_id IS NOT NULL`);
  return rows.map((r) => r.batch_id);
}

export async function pendingOf(batchId: string): Promise<Digest[]> {
  const { rows } = await pool.query<DigestRow>(`SELECT ${DIGEST_COLS} FROM mentor_digests WHERE batch_id = $1 AND status = 'pending'`, [batchId]);
  return rows.map(toDigest);
}

export async function setDigestBatch(ids: readonly number[], batchId: string): Promise<void> {
  if (ids.length) await pool.query(`UPDATE mentor_digests SET batch_id = $2, updated_at = now() WHERE id = ANY($1::bigint[])`, [ids, batchId]);
}

export async function failDigests(ids: readonly number[]): Promise<void> {
  if (ids.length) await pool.query(`UPDATE mentor_digests SET status = 'failed', updated_at = now() WHERE id = ANY($1::bigint[]) AND status = 'pending'`, [ids]);
}

/** Trader × kind × period already generated (any language) — the scheduled push skips them. */
export async function digestExists(kind: RhythmKind, period: string): Promise<Set<string>> {
  const { rows } = await pool.query<{ trader: string }>(`SELECT DISTINCT trader FROM mentor_digests WHERE kind = $1 AND period = $2 AND status <> 'failed'`, [kind, period]);
  return new Set(rows.map((r) => r.trader));
}

// ─── escalations ────────────────────────────────────────────────────────────

export type Escalation = {
  id: number; trader: string; rule: EscalationRule; day: string; params: Record<string, number>; notified: string[];
  status: "open" | "acknowledged"; ackBy: string | null; ackAt: string | null; createdAt: string;
};
type EscRow = { id: string; trader: string; rule: EscalationRule; day: string; params: Record<string, number> | null; notified: string[]; status: Escalation["status"]; ack_by: string | null; ack_at: Date | null; created_at: Date };
const ESC_COLS = `id, trader, rule, day, params, notified, status, ack_by, ack_at, created_at`;
const toEsc = (r: EscRow): Escalation => ({
  id: Number(r.id), trader: r.trader, rule: r.rule, day: r.day, params: r.params ?? {}, notified: r.notified ?? [], status: r.status,
  ackBy: r.ack_by, ackAt: iso(r.ack_at), createdAt: iso(r.created_at)!,
});

/** Escalations of the traders since `from` (newest first). */
export async function escalationsOf(traders: readonly string[], from: string): Promise<Escalation[]> {
  if (!traders.length) return [];
  const { rows } = await pool.query<EscRow>(
    `SELECT ${ESC_COLS} FROM mentor_escalations WHERE trader = ANY($1::text[]) AND day >= $2 ORDER BY created_at DESC LIMIT 200`,
    [traders, from],
  );
  return rows.map(toEsc);
}

/** Inserts one escalation; null when the same trader × rule × day exists already (a second run of the same day). */
export async function insertEscalation(e: { trader: string; rule: EscalationRule; day: string; params: Record<string, number>; notified: string[] }): Promise<Escalation | null> {
  const { rows } = await pool.query<EscRow>(
    `INSERT INTO mentor_escalations (trader, rule, day, params, notified) VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (trader, rule, day) DO NOTHING RETURNING ${ESC_COLS}`,
    [e.trader, e.rule, e.day, JSON.stringify(e.params), e.notified],
  );
  return rows[0] ? toEsc(rows[0]) : null;
}

export async function escalationById(id: number): Promise<Escalation | null> {
  const { rows } = await pool.query<EscRow>(`SELECT ${ESC_COLS} FROM mentor_escalations WHERE id = $1`, [id]);
  return rows[0] ? toEsc(rows[0]) : null;
}

export async function acknowledgeEscalation(id: number, by: string): Promise<Escalation | null> {
  const { rows } = await pool.query<EscRow>(
    `UPDATE mentor_escalations SET status = 'acknowledged', ack_by = $2, ack_at = now() WHERE id = $1 AND status = 'open' RETURNING ${ESC_COLS}`,
    [id, by],
  );
  return rows[0] ? toEsc(rows[0]) : null;
}

// ─── admin cost ─────────────────────────────────────────────────────────────

export type MentorCost = { from: string; to: string; calls: number; users: number; costUsd: number; liveUsd: number; batchUsd: number; errors: number; days: { day: string; calls: number; costUsd: number }[] };

/** The mentor's calls between two NY days, from the assistant audit (mode mentor / mentor_batch). */
export async function mentorCost(from: string, to: string): Promise<MentorCost> {
  const { rows } = await pool.query<{ day: string; mode: string; calls: string; users: string; cost: string; errors: string }>(
    `SELECT to_char(created_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS day, mode, COUNT(*)::text AS calls,
            COUNT(DISTINCT user_name)::text AS users, COALESCE(SUM(cost_usd), 0)::text AS cost,
            COUNT(*) FILTER (WHERE status <> 'ok')::text AS errors
       FROM ai_assistant_audit
      WHERE mode IN ('mentor', 'mentor_batch')
        AND to_char(created_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') BETWEEN $1 AND $2
      GROUP BY 1, 2 ORDER BY 1`,
    [from, to],
  );
  const users = await pool.query<{ n: string }>(
    `SELECT COUNT(DISTINCT user_name)::text AS n FROM ai_assistant_audit WHERE mode IN ('mentor', 'mentor_batch')
        AND to_char(created_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') BETWEEN $1 AND $2`,
    [from, to],
  );
  const days = new Map<string, { calls: number; costUsd: number }>();
  let calls = 0, live = 0, batch = 0, errors = 0;
  for (const r of rows) {
    const c = Number(r.cost) || 0;
    const n = Number(r.calls) || 0;
    calls += n;
    errors += Number(r.errors) || 0;
    if (r.mode === "mentor_batch") batch += c; else live += c;
    const d = days.get(r.day) ?? { calls: 0, costUsd: 0 };
    days.set(r.day, { calls: d.calls + n, costUsd: d.costUsd + c });
  }
  return {
    from, to, calls, users: Number(users.rows[0]?.n) || 0, costUsd: live + batch, liveUsd: live, batchUsd: batch, errors,
    days: [...days].map(([day, v]) => ({ day, ...v })),
  };
}
