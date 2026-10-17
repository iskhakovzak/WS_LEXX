import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { asyncHandler } from "../lib/asyncHandler";
import { requireCap } from "../lib/permissions";
import { logger } from "../lib/logger";
import { requireAuth } from "../lib/auth";
import { nyDate } from "../lib/tradingDate";
import { netPnlSql, signedRSql } from "../lib/tradeMath";
import { handleAiNotConfigured } from "../lib/aiErrors";

const router: IRouter = Router();
const AI_MODEL = "claude-sonnet-4-6";
const AI_TIMEOUT_MS = 40_000;

// DATE columns are returned as "YYYY-MM-DD" strings: node-pg would otherwise build a
// local-midnight Date that serialises to the previous day in UTC+N server timezones.
const NOTE_COLS = `id, trader, TO_CHAR(note_date, 'YYYY-MM-DD') AS note_date, raw_text, refined_text, mood,
  sections, curator_feedback, curator_score, reviewed_by, reviewed_at, feedback_seen_at,
  created_at, updated_at`;

/* ------------------------------------------------------------------ */
/* Additive schema: structured sections, curator review, reminders.    */
/* Guarded init promise — runs once per process, retried on failure.   */
/* ------------------------------------------------------------------ */
let ensured: Promise<void> | null = null;
function ensureSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await pool.query(`ALTER TABLE junior_notes ADD COLUMN IF NOT EXISTS sections JSONB`);
      await pool.query(`ALTER TABLE junior_notes ADD COLUMN IF NOT EXISTS curator_feedback TEXT`);
      await pool.query(`ALTER TABLE junior_notes ADD COLUMN IF NOT EXISTS curator_score SMALLINT`);
      await pool.query(`ALTER TABLE junior_notes ADD COLUMN IF NOT EXISTS reviewed_by TEXT`);
      await pool.query(`ALTER TABLE junior_notes ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`);
      await pool.query(`ALTER TABLE junior_notes ADD COLUMN IF NOT EXISTS feedback_seen_at TIMESTAMPTZ`);
      await pool.query(
        `CREATE TABLE IF NOT EXISTS junior_note_reminders (
           id SERIAL PRIMARY KEY,
           trader TEXT NOT NULL,
           note_date DATE NOT NULL,
           curator TEXT NOT NULL,
           message TEXT,
           created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           dismissed_at TIMESTAMPTZ,
           UNIQUE (trader, note_date)
         )`,
      );
    })().catch((e) => {
      ensured = null;
      throw e;
    });
  }
  return ensured;
}

const SECTION_KEYS = ["free", "plan", "intraday", "overnight", "swing", "mistakes", "lessons", "focus"] as const;
type SectionKey = (typeof SECTION_KEYS)[number];
type Sections = Partial<Record<SectionKey, string>>;
const SECTION_TITLES: Record<SectionKey, string> = {
  free: "",
  plan: "План",
  intraday: "Сделки — интрадей",
  overnight: "Сделки — овернайт",
  swing: "Сделки — свинг",
  mistakes: "Ошибки",
  lessons: "Уроки",
  focus: "Фокус на завтра",
};
const MAX_SECTION_LEN = 6000;

/** Validates and normalises the `sections` payload; returns null when absent/invalid. */
function parseSections(v: unknown): Sections | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Sections = {};
  for (const k of SECTION_KEYS) {
    const raw = (v as Record<string, unknown>)[k];
    if (typeof raw === "string" && raw.trim()) out[k] = raw.slice(0, MAX_SECTION_LEN);
  }
  return out;
}

/** Flat text used by search, AI and older clients. The untitled `free` block comes first without a heading. */
function composeSections(s: Sections): string {
  return SECTION_KEYS
    .filter((k) => s[k]?.trim())
    .map((k) => (SECTION_TITLES[k] ? `${SECTION_TITLES[k]}:\n${s[k]!.trim()}` : s[k]!.trim()))
    .join("\n\n");
}

function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v + "T00:00:00Z"));
}

// Trading day = New York calendar date (audit P0-3), never UTC / the DB session's CURRENT_DATE.
function todayNy(): string {
  return nyDate();
}

function parseLimit(v: unknown, def = 30, max = 100): number {
  const n = Math.floor(Number(v ?? def));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : def;
}

function cleanMood(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 32) : null;
}

// Curator views / reviews / reminders = journal.review (permissions matrix; DB role, active & not banned).

/* Trading-day helpers (Mon–Fri; exchange holidays are not modelled). */
function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function isWeekend(iso: string): boolean {
  const wd = new Date(iso + "T00:00:00Z").getUTCDay();
  return wd === 0 || wd === 6;
}
function prevTradingDay(iso: string): string {
  let d = addDays(iso, -1);
  while (isWeekend(d)) d = addDays(d, -1);
  return d;
}
/** Consecutive trading days with a note, ending at `date` (or the trading day before if `date` has none yet). */
function streakEndingAt(dates: Set<string>, date: string): number {
  let d = date;
  while (isWeekend(d)) d = prevTradingDay(d);
  if (!dates.has(d)) d = prevTradingDay(d);
  let n = 0;
  while (dates.has(d) && n < 400) { n++; d = prevTradingDay(d); }
  return n;
}

router.get("/junior-notes/team", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  await ensureSchema();
  const date = (req.query["date"] as string | undefined) || todayNy();
  if (!isIsoDate(date)) { res.status(400).json({ error: "Некорректная дата" }); return; }
  const { rows } = await pool.query(
    `SELECT ${NOTE_COLS}
     FROM junior_notes WHERE note_date = $1 ORDER BY trader ASC`,
    [date],
  );
  res.json(rows);
}));

/**
 * Curator desk overview for one day: every active trader, whether they wrote, streak,
 * review state and pending in-app reminder.
 */
router.get("/junior-notes/overview", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  await ensureSchema();
  if (!(await requireCap(req, res, "journal.review", null, "Только для кураторов"))) return;
  const date = (req.query["date"] as string | undefined) || todayNy();
  if (!isIsoDate(date)) { res.status(400).json({ error: "Некорректная дата" }); return; }
  const from = addDays(date, -90);

  const [usersRes, notesRes, remindersRes] = await Promise.all([
    pool.query<{ name: string }>(
      `SELECT name FROM users WHERE role = 'trader' AND active = true AND COALESCE(banned, false) = false ORDER BY name`,
    ),
    pool.query<{
      id: number; trader: string; note_date: string; mood: string | null; raw_text: string;
      curator_score: number | null; reviewed_at: string | null; reviewed_by: string | null; updated_at: string;
    }>(
      `SELECT id, trader, TO_CHAR(note_date, 'YYYY-MM-DD') AS note_date, mood, raw_text,
              curator_score, reviewed_at, reviewed_by, updated_at
       FROM junior_notes
       WHERE note_date BETWEEN $1 AND $2 AND LENGTH(TRIM(raw_text)) > 0
       ORDER BY note_date DESC`,
      [from, date],
    ),
    pool.query<{ id: number; trader: string; curator: string; created_at: string; dismissed_at: string | null }>(
      `SELECT id, trader, curator, created_at, dismissed_at FROM junior_note_reminders WHERE note_date = $1`,
      [date],
    ),
  ]);

  const byTrader = new Map<string, typeof notesRes.rows>();
  for (const n of notesRes.rows) {
    const list = byTrader.get(n.trader) ?? [];
    list.push(n);
    byTrader.set(n.trader, list);
  }
  const names = new Set(usersRes.rows.map((u) => u.name));
  for (const n of notesRes.rows) if (n.note_date === date) names.add(n.trader);
  const reminders = new Map(remindersRes.rows.map((r) => [r.trader, r]));

  const rows = [...names].sort((a, b) => a.localeCompare(b, "ru")).map((trader) => {
    const notes = byTrader.get(trader) ?? [];
    const dates = new Set(notes.map((n) => n.note_date));
    const today = notes.find((n) => n.note_date === date) ?? null;
    const last14 = addDays(date, -14);
    const scores = notes.filter((n) => n.curator_score != null).map((n) => n.curator_score!);
    const r = reminders.get(trader);
    return {
      trader,
      note: today && {
        id: today.id,
        mood: today.mood,
        words: today.raw_text.trim().split(/\s+/).filter(Boolean).length,
        preview: today.raw_text.trim().slice(0, 180),
        curator_score: today.curator_score,
        reviewed_at: today.reviewed_at,
        reviewed_by: today.reviewed_by,
        updated_at: today.updated_at,
      },
      streak: streakEndingAt(dates, date),
      last_note_date: notes[0]?.note_date ?? null,
      notes_30d: notes.filter((n) => n.note_date > addDays(date, -30)).length,
      unreviewed_14d: notes.filter((n) => n.note_date > last14 && !n.reviewed_at).length,
      avg_score: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
      reminder: r && !r.dismissed_at ? { id: r.id, curator: r.curator, created_at: r.created_at } : null,
    };
  });
  res.json({ date, rows });
}));

/** Curator review queue: written notes without a curator answer over the last N days, oldest first. */
router.get("/junior-notes/queue", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  await ensureSchema();
  if (!(await requireCap(req, res, "journal.review", null, "Только для кураторов"))) return;
  const days = parseLimit(req.query["days"], 14, 60);
  const { rows } = await pool.query(
    `SELECT ${NOTE_COLS}
     FROM junior_notes
     WHERE reviewed_at IS NULL AND LENGTH(TRIM(raw_text)) > 0
       AND note_date >= $3::date - $1::int AND trader <> $2
     ORDER BY note_date ASC, trader ASC
     LIMIT 100`,
    [days, req.authUser!.name, todayNy()],
  );
  res.json(rows);
}));

router.get("/junior-notes/history", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  await ensureSchema();
  const trader = (req.query["trader"] as string | undefined) || req.authUser?.name;
  const limit = parseLimit(req.query["limit"], 30, 400);
  const q = typeof req.query["q"] === "string" ? req.query["q"].trim().slice(0, 100) : "";
  if (!trader) { res.status(400).json({ error: "trader required" }); return; }
  const params: unknown[] = [trader, limit];
  let where = `trader = $1`;
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, (m) => "\\" + m)}%`);
    where += ` AND (raw_text ILIKE $3 OR COALESCE(curator_feedback, '') ILIKE $3)`;
  }
  const { rows } = await pool.query(
    `SELECT ${NOTE_COLS}
     FROM junior_notes WHERE ${where} ORDER BY note_date DESC LIMIT $2`,
    params,
  );
  res.json(rows);
}));

/** In-app reminders addressed to the current user that are still open (no note written yet). */
router.get("/junior-notes/reminders/me", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  await ensureSchema();
  const me = req.authUser!.name;
  const { rows } = await pool.query(
    `SELECT r.id, r.trader, TO_CHAR(r.note_date, 'YYYY-MM-DD') AS note_date, r.curator, r.message, r.created_at
     FROM junior_note_reminders r
     WHERE r.trader = $1 AND r.dismissed_at IS NULL AND r.note_date >= $2::date - 14
       AND NOT EXISTS (
         SELECT 1 FROM junior_notes n
         WHERE n.trader = r.trader AND n.note_date = r.note_date AND LENGTH(TRIM(n.raw_text)) > 0
       )
     ORDER BY r.note_date DESC`,
    [me, todayNy()],
  );
  res.json(rows);
}));

router.get("/junior-notes", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  await ensureSchema();
  const trader = (req.query["trader"] as string | undefined) || req.authUser?.name;
  const date = (req.query["date"] as string | undefined) || todayNy();
  if (!trader) { res.status(400).json({ error: "trader required" }); return; }
  if (!isIsoDate(date)) { res.status(400).json({ error: "Некорректная дата" }); return; }
  const { rows } = await pool.query(
    `SELECT ${NOTE_COLS}
     FROM junior_notes WHERE trader = $1 AND note_date = $2 LIMIT 1`,
    [trader, date],
  );
  res.json(rows[0] ?? null);
}));

router.put("/junior-notes", asyncHandler(async (req, res): Promise<void> => {
  await ensureSchema();
  const trader = req.authUser!.name;
  const { raw_text, note_date, mood } = req.body as { raw_text?: string; note_date?: string; mood?: string };
  const sections = parseSections((req.body as { sections?: unknown }).sections);
  const date = note_date || todayNy();
  if (!isIsoDate(date)) { res.status(400).json({ error: "Некорректная дата" }); return; }
  if (date > addDays(todayNy(), 1)) { res.status(400).json({ error: "Нельзя писать сводку за будущую дату" }); return; }
  const text = sections ? composeSections(sections) : (typeof raw_text === "string" ? raw_text : "").trim().slice(0, 40_000);
  const { rows } = await pool.query(
    `INSERT INTO junior_notes (trader, note_date, raw_text, mood, sections, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (trader, note_date) DO UPDATE
       SET raw_text = EXCLUDED.raw_text,
           mood = EXCLUDED.mood,
           sections = EXCLUDED.sections,
           updated_at = NOW()
     RETURNING ${NOTE_COLS}`,
    [trader, date, text, cleanMood(mood), sections ? JSON.stringify(sections) : null],
  );
  res.json(rows[0]);
}));

router.patch("/junior-notes/:id", asyncHandler(async (req, res): Promise<void> => {
  await ensureSchema();
  const trader = req.authUser!.name;
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
  const { raw_text, mood } = req.body as { raw_text?: string; mood?: string };
  const sections = parseSections((req.body as { sections?: unknown }).sections);
  const text = sections ? composeSections(sections) : (typeof raw_text === "string" ? raw_text.slice(0, 40_000) : null);
  const { rows } = await pool.query(
    `UPDATE junior_notes
     SET raw_text = COALESCE($1, raw_text),
         mood = $2,
         sections = CASE WHEN $5::boolean THEN $6::jsonb ELSE sections END,
         refined_text = NULL,
         updated_at = NOW()
     WHERE id = $3 AND trader = $4
     RETURNING ${NOTE_COLS}`,
    [text, cleanMood(mood), id, trader, !!sections, sections ? JSON.stringify(sections) : null],
  );
  if (!rows[0]) { res.status(404).json({ error: "Not found" }); return; }
  res.json(rows[0]);
}));

/** Curator review: written feedback + 1–5 score. Empty feedback and no score clears the review. */
router.post("/junior-notes/:id/review", asyncHandler(async (req, res): Promise<void> => {
  await ensureSchema();
  const curator = req.authUser!.name;
  if (!(await requireCap(req, res, "journal.review", null, "Только куратор может оценивать сводки"))) return;
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as { feedback?: unknown; score?: unknown };
  const feedback = typeof body.feedback === "string" ? body.feedback.trim().slice(0, 4000) : "";
  let score: number | null = null;
  if (body.score != null && body.score !== "") {
    const n = Number(body.score);
    if (!Number.isInteger(n) || n < 1 || n > 5) { res.status(400).json({ error: "Оценка должна быть от 1 до 5" }); return; }
    score = n;
  }
  const clear = !feedback && score == null;
  const { rows } = await pool.query(
    `UPDATE junior_notes
     SET curator_feedback = $1,
         curator_score = $2,
         reviewed_by = CASE WHEN $4::boolean THEN NULL ELSE $3 END,
         reviewed_at = CASE WHEN $4::boolean THEN NULL ELSE NOW() END,
         feedback_seen_at = NULL
     WHERE id = $5
     RETURNING ${NOTE_COLS}`,
    [feedback || null, score, curator, clear, id],
  );
  if (!rows[0]) { res.status(404).json({ error: "Not found" }); return; }
  res.json(rows[0]);
}));

/** Owner marks curator feedback as read (clears the unread marker). */
router.post("/junior-notes/:id/seen", asyncHandler(async (req, res): Promise<void> => {
  await ensureSchema();
  const trader = req.authUser!.name;
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
  const { rows } = await pool.query(
    `UPDATE junior_notes SET feedback_seen_at = NOW()
     WHERE id = $1 AND trader = $2 AND reviewed_at IS NOT NULL
     RETURNING ${NOTE_COLS}`,
    [id, trader],
  );
  if (!rows[0]) { res.status(404).json({ error: "Not found" }); return; }
  res.json(rows[0]);
}));

/** Curator → junior in-app reminder for a missing summary (no external sends). */
router.post("/junior-notes/reminders", asyncHandler(async (req, res): Promise<void> => {
  await ensureSchema();
  const curator = req.authUser!.name;
  if (!(await requireCap(req, res, "journal.review", null, "Только для кураторов"))) return;
  const body = req.body as { trader?: unknown; date?: unknown; message?: unknown };
  const trader = typeof body.trader === "string" ? body.trader.trim() : "";
  const date = isIsoDate(body.date) ? body.date : todayNy();
  const message = typeof body.message === "string" && body.message.trim() ? body.message.trim().slice(0, 300) : null;
  if (!trader) { res.status(400).json({ error: "trader required" }); return; }
  const exists = await pool.query(`SELECT 1 FROM users WHERE name = $1 AND active = true LIMIT 1`, [trader]);
  if (!exists.rows.length) { res.status(404).json({ error: "Трейдер не найден" }); return; }
  const { rows } = await pool.query(
    `INSERT INTO junior_note_reminders (trader, note_date, curator, message)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (trader, note_date) DO UPDATE
       SET curator = EXCLUDED.curator, message = EXCLUDED.message, created_at = NOW(), dismissed_at = NULL
     RETURNING id, trader, TO_CHAR(note_date, 'YYYY-MM-DD') AS note_date, curator, message, created_at`,
    [trader, date, curator, message],
  );
  res.json(rows[0]);
}));

router.post("/junior-notes/reminders/:id/dismiss", asyncHandler(async (req, res): Promise<void> => {
  await ensureSchema();
  const me = req.authUser!.name;
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
  const { rowCount } = await pool.query(
    `UPDATE junior_note_reminders SET dismissed_at = NOW() WHERE id = $1 AND trader = $2`,
    [id, me],
  );
  if (!rowCount) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ok: true });
}));

router.delete("/junior-notes/:id", asyncHandler(async (req, res): Promise<void> => {
  const trader = req.authUser!.name;
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { rowCount } = await pool.query(
    `DELETE FROM junior_notes WHERE id = $1 AND trader = $2`,
    [id, trader],
  );
  if (!rowCount) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ok: true });
}));

router.post("/junior-notes/improve", asyncHandler(async (req, res): Promise<void> => {
  const trader = req.authUser!.name;
  const { text, note_id, note_date } = req.body as { text: string; note_id?: number; note_date?: string };
  if (!text?.trim()) { res.status(400).json({ error: "text required" }); return; }

  const date = isIsoDate(note_date) ? note_date : todayNy();
  const tradesRes = await pool.query(
    `SELECT t.ticker, t.result, ROUND(${netPnlSql("t")}, 2) AS pnl_net, ROUND(${signedRSql("t")}, 2) AS r_signed, t.setup
     FROM trades t WHERE t.trader = $1 AND t.date = $2 AND t.deleted_at IS NULL ORDER BY t.created_at LIMIT 10`,
    [trader, date],
  );
  const tradesContext = tradesRes.rows.length > 0
    ? `\nТрейды ${trader} за ${date}:\n${tradesRes.rows.map((t: any) =>
        `- ${t.ticker}: ${t.result}${t.pnl_net != null ? ` | PnL нетто: $${t.pnl_net}` : ""}${t.r_signed != null ? ` | R: ${t.r_signed}` : ""}${t.setup ? ` | Сетап: ${t.setup}` : ""}`
      ).join("\n")}`
    : "";

  const prompt = `Ты — ментор для начинающих трейдеров. Трейдер ${trader} написал сводку о своём торговом дне. Твоя задача — помочь структурировать мысли, задать направляющие вопросы и поддержать обучение.
${tradesContext}

Оригинальная запись:
"""
${text.slice(0, 3000)}
"""

Улучши и структурируй текст. Используй только те разделы, о которых пишет трейдер:

**📊 Что наблюдал сегодня** — рыночные ситуации, которые заметил

**✅ Что получилось** — правильные действия и решения

**❌ Что можно улучшить** — ошибки и зоны роста

**❓ Вопросы на разбор** — что непонятно, что хочешь разобрать с куратором

**🎯 Фокус на завтра** — конкретный фокус

Пиши кратко, по-деловому, от первого лица. Сохраняй тикеры и цифры из оригинала.`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  try {
    const msg = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }, { signal: ctrl.signal as AbortSignal });
    clearTimeout(t);
    const refined = msg.content[0]?.type === "text" ? msg.content[0].text : "";
    if (note_id) {
      await pool.query(
        `UPDATE junior_notes SET refined_text = $1, updated_at = NOW() WHERE id = $2 AND trader = $3`,
        [refined, note_id, trader],
      );
    }
    res.json({ refined_text: refined });
  } catch (e: any) {
    clearTimeout(t);
    if (handleAiNotConfigured(e, res)) return;
    logger.warn({ error: e.message, trader }, "junior-notes improve failed");
    res.status(502).json({ error: "AI недоступен, попробуй позже" });
  }
}));

router.post("/junior-notes/team-summary", asyncHandler(async (req, res): Promise<void> => {
  const raw = (req.body as { note_ids?: unknown }).note_ids;
  const note_ids = Array.isArray(raw) ? raw.map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 100) : [];
  if (note_ids.length === 0) {
    res.status(400).json({ error: "Выбери хотя бы одну запись" }); return;
  }
  const { rows } = await pool.query(
    `SELECT trader, TO_CHAR(note_date, 'YYYY-MM-DD') AS note_date, raw_text, refined_text, mood
     FROM junior_notes WHERE id = ANY($1) ORDER BY trader, note_date`,
    [note_ids],
  );
  if (rows.length === 0) { res.status(400).json({ error: "Записи не найдены" }); return; }

  const notesText = rows.map((n: any) =>
    `### ${n.trader} (${n.note_date}${n.mood ? `, настроение: ${n.mood}` : ""})\n${n.refined_text || n.raw_text}`
  ).join("\n\n");

  const prompt = `Ты — куратор начинающих трейдеров. Создай общую сводку по записям джунов за день.

ЗАПИСИ ДЖУНОВ:
${notesText.slice(0, 8000)}

Создай структурированную кураторскую сводку:

**📊 Общий прогресс группы** — как джуны провели день, общая динамика

**✅ Что хорошо получается** — повторяющиеся успехи и правильные паттерны у нескольких трейдеров

**❌ Общие ошибки** — что стоит разобрать с группой

**❓ Вопросы для разбора** — вопросы и непонятные ситуации от джунов, которые нужно объяснить

**📋 Рекомендации куратора** — конкретные задачи и фокусы на следующий день для группы

Пиши конкретно, ссылайся на реальные примеры. Не придумывай ничего, чего нет в записях. На русском.`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  try {
    const msg = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }, { signal: ctrl.signal as AbortSignal });
    clearTimeout(t);
    const summary = msg.content[0]?.type === "text" ? msg.content[0].text : "";
    res.json({ summary });
  } catch (e: any) {
    clearTimeout(t);
    if (handleAiNotConfigured(e, res)) return;
    logger.warn({ error: e.message }, "junior-notes team-summary failed");
    res.status(502).json({ error: "AI недоступен, попробуй позже" });
  }
}));

export default router;
