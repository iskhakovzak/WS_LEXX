/**
 * «Кабинет куратора» — private staff notes about a trader (split out of routes/curator.ts, mounted by it).
 *
 *   GET   /curator/notes?trader=         notes about a trader (staff; the trader never sees them)
 *   POST  /curator/notes                 {trader, body, kind?, pinned?, day?}
 *   PATCH /curator/notes/:id             {body?, kind?, pinned?} — body by its author only
 *   POST  /curator/notes/:id/archive     soft delete
 *   POST  /curator/notes/:id/restore     undo an archive (within a day)
 *
 * A «concern» note is an intervention (roadmap R9a): one curator_interventions row per note.
 * Access: journal.review on the note's trader.
 */
import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { can, requireCap } from "../lib/permissions";
import { logAudit } from "../lib/audit";
import { rowToNote } from "../lib/curatorStore";
import { AppError, badRequest, forbidden, notFound } from "../lib/http";
import { logInterventionSafe } from "../lib/interventions/log";

const router: IRouter = Router();

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

const NOTE_KINDS = ["note", "call", "concern", "praise"] as const;

router.get("/curator/notes", asyncHandler(async (req, res): Promise<void> => {
  const trader = typeof req.query.trader === "string" ? req.query.trader.trim() : "";
  if (!trader || trader.length > 100) throw badRequest("TRADER_REQUIRED");
  if (!(await requireCap(req, res, "journal.review", { trader }))) return;
  const { rows } = await pool.query(`SELECT * FROM curator_notes WHERE archived_at IS NULL AND trader = $1 ORDER BY pinned DESC, created_at DESC LIMIT 200`, [trader]);
  res.json({ trader, notes: rows.map(rowToNote) });
}));

const NoteBody = z.object({
  trader: z.string().trim().min(1).max(100),
  body: z.string().trim().min(1).max(4000),
  kind: z.enum(NOTE_KINDS).default("note"),
  pinned: z.boolean().default(false),
  /** The NY trading day the note is about (a queue row's day): it resolves only that day (lib/daily/costQueue). */
  day: z.string().regex(YMD_RE).nullish(),
}).strict();

router.post("/curator/notes", asyncHandler(async (req, res): Promise<void> => {
  // Rights first (DEV-18): a reader without journal.review gets 403, not a form error.
  const rawTrader = typeof req.body?.trader === "string" ? req.body.trader.trim() : "";
  if (!(await requireCap(req, res, "journal.review", rawTrader ? { trader: rawTrader } : undefined))) return;
  const parsed = NoteBody.safeParse(req.body ?? {});
  if (!parsed.success) throw parsed.error.issues[0]?.path[0] === "body" ? new AppError("NOTE_EMPTY", 400, undefined, parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))) : parsed.error;
  const b = parsed.data;
  const { rows: exists } = await pool.query(`SELECT 1 FROM users WHERE name = $1 LIMIT 1`, [b.trader]);
  if (!exists.length) throw notFound("TRADER_NOT_FOUND");
  const { rows } = await pool.query(
    `INSERT INTO curator_notes (trader, author, body, kind, pinned, day) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [b.trader, req.authUser!.name, b.body, b.kind, b.pinned, b.day ?? null],
  );
  if (b.kind === "concern") await logConcern(rows[0]);
  res.status(201).json(rowToNote(rows[0]));
}));

const NotePatch = z.object({
  body: z.string().trim().min(1).max(4000).optional(),
  kind: z.enum(NOTE_KINDS).optional(),
  pinned: z.boolean().optional(),
}).strict();

/** R9a: a «concern» note is an intervention (one row per note, lib/interventions/log). */
const logConcern = (n: any) => logInterventionSafe({ trader: String(n.trader), kind: "concern_note", author: String(n.author), sourceTable: "curator_notes", sourceId: n.id });

/** Throws 404 NOTE_NOT_FOUND / 403 FORBIDDEN. */
async function loadNoteForEdit(req: Request, id: number): Promise<{ ok: true; row: any }> {
  const { rows } = await pool.query(`SELECT * FROM curator_notes WHERE id = $1 AND archived_at IS NULL`, [id]);
  const row = rows[0];
  if (!row) throw notFound("NOTE_NOT_FOUND");
  if (!(await can(req, "journal.review", { trader: String(row.trader) }))) throw forbidden("journal.review");
  // Body is edited by its author only; pin / kind — by any staff member of the trader.
  return { ok: true, row };
}

router.patch("/curator/notes/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("INVALID_ID");
  const parsed = NotePatch.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest("VALIDATION");
  const found = await loadNoteForEdit(req, id);
  const p = parsed.data;
  if (p.body !== undefined && found.row.author !== req.authUser!.name) throw new AppError("NOTE_AUTHOR_ONLY");
  const { rows } = await pool.query(
    `UPDATE curator_notes SET body = COALESCE($2, body), kind = COALESCE($3, kind), pinned = COALESCE($4, pinned), updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, p.body ?? null, p.kind ?? null, p.pinned ?? null],
  );
  if (p.kind === "concern" && found.row.kind !== "concern") await logConcern(rows[0]);
  res.json(rowToNote(rows[0]));
}));

router.post("/curator/notes/:id/archive", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("INVALID_ID");
  const found = await loadNoteForEdit(req, id);
  await pool.query(`UPDATE curator_notes SET archived_at = NOW(), archived_by = $2 WHERE id = $1`, [id, req.authUser!.name]);
  await logAudit({ actor: req.authUser!.name, action: "curator.note.archive", targetType: "curator_notes", targetId: String(id), details: { trader: found.row.trader, author: found.row.author } });
  res.json({ ok: true });
}));

/** «Отменить» после архивации заметки: вернуть её (только недавно архивированную — за последние сутки). */
router.post("/curator/notes/:id/restore", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("INVALID_ID");
  const { rows } = await pool.query(`SELECT * FROM curator_notes WHERE id = $1 AND archived_at IS NOT NULL AND archived_at > NOW() - INTERVAL '1 day'`, [id]);
  const row = rows[0];
  if (!row) throw notFound("NOTE_NOT_FOUND");
  if (!(await can(req, "journal.review", { trader: String(row.trader) }))) throw forbidden();
  const { rows: out } = await pool.query(`UPDATE curator_notes SET archived_at = NULL, archived_by = NULL WHERE id = $1 RETURNING *`, [id]);
  await logAudit({ actor: req.authUser!.name, action: "curator.note.restore", targetType: "curator_notes", targetId: String(id), details: { trader: row.trader } });
  res.json(rowToNote(out[0]));
}));

export default router;
