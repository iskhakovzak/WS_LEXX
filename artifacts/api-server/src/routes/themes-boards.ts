/**
 * Personal boards on /themes (lib/themes/board*, migration 0226). Any signed-in member, owner only, ≤ 8 active.
 *
 *   GET  /api/themes/boards/:id   BoardDataResponse — the board's rows (themes: pinned shared + own themes; tickers: one
 *                                 row per ticker with the 4 moves, gap %, RVOL, float)
 *   POST /api/themes/boards       { name, kind: themes | tickers, columns?, pinned? (themes), tickers? | screener? +
 *                                 order? + top? (tickers: a list ≤ 50, or a Finviz screener, top 25 / 50) } → BoardMeta
 *   PUT  /api/themes/boards/:id   any of { name, columns, sort, pinned, tickers | screener + order + top, move: left |
 *                                 right, active } → BoardMeta (archive = active false; nothing is deleted). Archiving
 *                                 a board archives its active themes with it (user_themes.archived_with_board).
 *   GET  /api/themes/archive      { boards: [{ id, name, kind, themes }], themes: [{ id, name, kind, boardId, boardName }] }
 *                                 — the owner's archived boards (themes = how many come back with it) and archived themes
 *                                 on an active board («Архив» in the «Вид» popover)
 *   POST /api/themes/boards/:id/restore  BoardMeta + { restoredThemes, skippedThemes } — the board back at the end of the
 *                                 strip (≤ 8 active) with the themes archived with it, as far as the limit of 10 allows
 *
 * A screener is a Finviz URL / f= query / filter list: only f and o are kept (lib/themes/personal parseScreenerInput —
 * the auth token is never stored or echoed). Writes are in the audit log.
 */
import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { AppError, idParam, notFound, route, unauthorized } from "../lib/http";
import { isGuestUser } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { THEME_TICKER_RE } from "../lib/themes/logic";
import { parseScreenerInput } from "../lib/themes/personal";
import {
  BOARD_TOPS, MAX_BOARDS, MAX_BOARD_TICKERS, MAX_PINNED, TICKER_COLUMNS, movePositions, normalizeColumns, normalizeBoardSort,
  type BoardKind, type BoardSource, type BoardTop,
} from "../lib/themes/boards";
import {
  archiveBoardThemes, boardById, countBoards, insertBoard, listArchive, listBoards, restoreBoard, setPositions, updateBoard, type BoardRecord,
} from "../lib/themes/boardsStore";
import { MAX_PERSONAL_THEMES } from "../lib/themes/personal";
import { boardMeta, getBoardData, refreshBoardScreener } from "../lib/themes/board";
import { screenerWriteLimiter } from "../lib/rateLimits";

const router: IRouter = Router();

const RESOLVE_WAIT_MS = 8_000;

function member(req: Request): { id: number; name: string } {
  const u = req.authUser;
  if (!u) throw unauthorized();
  if (isGuestUser(u)) throw new AppError("GUEST_READ_ONLY");
  return { id: u.id, name: u.name };
}

const Name = z.string().trim().min(1).max(40);
const BoardTickers = z
  .array(z.string().max(12))
  .max(MAX_BOARD_TICKERS * 2)
  .transform((list) => [...new Set(list.map((s) => s.trim().toUpperCase().replace(/^\$/, "")).filter(Boolean))])
  .pipe(z.array(z.string().regex(THEME_TICKER_RE, "ticker: A–Z . - (≤ 10)")).min(1).max(MAX_BOARD_TICKERS));
const Columns = z.array(z.enum(TICKER_COLUMNS as unknown as [string, ...string[]])).min(1).max(TICKER_COLUMNS.length);
const Pinned = z.array(z.number().int().positive()).max(MAX_PINNED);
const Top = z.union([z.literal(BOARD_TOPS[0]), z.literal(BOARD_TOPS[1])]);
const SourceFields = {
  tickers: BoardTickers.optional(),
  screener: z.string().trim().max(2000).optional(),
  order: z.string().trim().max(41).nullable().optional(),
  top: Top.optional(),
};

const CreateBody = z.object({ name: Name, kind: z.enum(["themes", "tickers"]), columns: Columns.optional(), pinned: Pinned.optional(), ...SourceFields });
const UpdateBody = z.object({
  name: Name.optional(),
  columns: Columns.optional(),
  sort: z.object({ col: z.string().max(20), dir: z.enum(["desc", "asc"]) }).nullable().optional(),
  pinned: Pinned.optional(),
  move: z.enum(["left", "right"]).optional(),
  active: z.boolean().optional(),
  ...SourceFields,
});

/** The tickers board's source from the body (a list wins over a screener); undefined when the body names none. */
function sourceFrom(body: { tickers?: string[]; screener?: string; order?: string | null; top?: BoardTop }, current: BoardSource | null): BoardSource | undefined {
  if (body.tickers) return { kind: "tickers", tickers: body.tickers };
  if (body.screener !== undefined || body.order !== undefined || body.top !== undefined) {
    const text = body.screener ?? (current?.kind === "screener" ? current.screener.filters.join(",") : "");
    const order = body.order !== undefined ? body.order : current?.kind === "screener" ? current.screener.order : null;
    const parsed = parseScreenerInput(text, order);
    if (!parsed.ok) throw new AppError("VALIDATION", 400, undefined, [{ path: "body.screener", message: parsed.reason }]);
    const top = body.top ?? (current?.kind === "screener" ? current.top : 25);
    return { kind: "screener", screener: parsed.spec, top };
  }
  return undefined;
}

async function resolveSoon(b: BoardRecord): Promise<BoardRecord> {
  if (b.source?.kind !== "screener") return b;
  await Promise.race([refreshBoardScreener(b), new Promise((res) => setTimeout(res, RESOLVE_WAIT_MS).unref?.())]);
  return b;
}

router.get("/themes/boards/:id", route({ params: z.object({ id: idParam }) }, async ({ req, params }) => {
  const data = await getBoardData(member(req).id, params.id);
  if (!data) throw notFound("BOARD_NOT_FOUND");
  return data;
}));

router.post("/themes/boards", screenerWriteLimiter, route({ body: CreateBody }, async ({ req, body }) => {
  const me = member(req);
  if ((await countBoards(me.id)) >= MAX_BOARDS) throw new AppError("BOARD_LIMIT", undefined, { max: MAX_BOARDS });
  const kind: BoardKind = body.kind;
  const source = kind === "tickers" ? sourceFrom(body, null) : null;
  if (kind === "tickers" && !source) throw new AppError("VALIDATION", 400, undefined, [{ path: "body.tickers", message: "tickers or screener" }]);
  const created = await resolveSoon(await insertBoard(me.id, {
    name: body.name, kind, columns: body.columns ? normalizeColumns(kind, body.columns) : undefined,
    pinned: kind === "themes" ? body.pinned : [], source,
  }));
  await logAudit({ actor: me.name, action: "themes.board.create", targetType: "user_board", targetId: String(created.id), details: { name: created.name, kind } });
  return boardMeta(created);
}));

router.put("/themes/boards/:id", screenerWriteLimiter, route({ params: z.object({ id: idParam }), body: UpdateBody }, async ({ req, params, body }) => {
  const me = member(req);
  const current = await boardById(me.id, params.id);
  if (!current) throw notFound("BOARD_NOT_FOUND");
  if (body.active === true && !current.active && (await countBoards(me.id)) >= MAX_BOARDS) throw new AppError("BOARD_LIMIT", undefined, { max: MAX_BOARDS });
  if (body.move) await setPositions(me.id, movePositions(await listBoards(me.id), current.id, body.move));
  const source = current.kind === "tickers" ? sourceFrom(body, current.source) : undefined;
  const updated = await updateBoard(me.id, current.id, {
    name: body.name,
    columns: body.columns ? normalizeColumns(current.kind, body.columns) : undefined,
    sort: body.sort === undefined ? undefined : normalizeBoardSort(current.kind, body.sort),
    pinned: current.kind === "themes" ? body.pinned : undefined,
    source,
    active: body.active,
  }, current);
  if (!updated) throw notFound("BOARD_NOT_FOUND");
  const archiving = body.active === false && current.active;
  const themesArchived = archiving ? await archiveBoardThemes(me.id, current.id) : 0;
  const out = updated.active && source ? await resolveSoon(updated) : updated;
  const action = archiving ? "themes.board.archive" : "themes.board.update";
  if (body.name || body.active !== undefined || source || body.pinned) {
    const details = archiving ? { name: out.name, kind: out.kind, themes: themesArchived } : { name: out.name, kind: out.kind };
    await logAudit({ actor: me.name, action, targetType: "user_board", targetId: String(out.id), details });
  }
  return boardMeta(out);
}));

// ─── «Архив» ──────────────────────────────────────────────────────────────────

router.get("/themes/archive", route({}, async ({ req }) => listArchive(member(req).id)));

router.post("/themes/boards/:id/restore", route({ params: z.object({ id: idParam }) }, async ({ req, params }) => {
  const me = member(req);
  const current = await boardById(me.id, params.id);
  if (!current) throw notFound("BOARD_NOT_FOUND");
  if (current.active) return { ...boardMeta(current), restoredThemes: 0, skippedThemes: 0 };
  if ((await countBoards(me.id)) >= MAX_BOARDS) throw new AppError("BOARD_LIMIT", undefined, { max: MAX_BOARDS });
  const done = await restoreBoard(me.id, current.id, MAX_PERSONAL_THEMES);
  if (!done) throw notFound("BOARD_NOT_FOUND");
  await logAudit({
    actor: me.name, action: "themes.board.restore", targetType: "user_board", targetId: String(done.board.id),
    details: { name: done.board.name, kind: done.board.kind, restoredThemes: done.restored, skippedThemes: done.skipped },
  });
  return { ...boardMeta(done.board), restoredThemes: done.restored, skippedThemes: done.skipped };
}));

export default router;
