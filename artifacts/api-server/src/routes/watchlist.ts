/**
 * Watchlist — two lists (Волна 1, item 1.18; lib/watchlist/scope.ts has the rules, migration 0233 the column):
 *   ?scope=mine   the caller's personal list (watchlist.owner = his id) — he alone reads and writes it
 *   ?scope=desk   the desk list (owner IS NULL) — everyone reads it, seniors and staff write it
 * GET without a scope answers the list remembered in users.settings.watchlistView (default «Свой»). Writes name the
 * list with `scope` in the body (default: the personal list — «В вотчлист» from /themes, the screener, analysts and
 * offerings lands there). A row of another trader's list is 404; a desk row for a non-senior is 403 NOT_OWNER.
 * «Торговал» / «мои сделки» come from the caller's OWN trades (nothing is written on GET any more).
 * Duplicates are per list: one active row per ticker in each list.
 *
 *   GET  /api/watchlist                 ?scope&inPlay=1 → rows (+ scope, canEdit, ideaCount, tradeCount, tradedToday …)
 *   POST /api/watchlist                 { ticker, …, list?, inPlay?, scope? } → row
 *   POST /api/watchlist/quick           { tickers ≤ 30, list?, scope? } → { created, moved, restored, existing, invalid }
 *   POST /api/watchlist/bulk            { ids ≤ 200, action: status | delete | restore | inplay | list, … } (rows the
 *                                       caller may not write are skipped and reported in `denied`)
 *   PATCH /api/watchlist/:id            content + status / list / inPlay
 *   POST /api/watchlist/:id/score · /score-all (?scope) · DELETE /:id · POST /:id/restore
 * plus routes/watchlist-view.ts (view, quotes).
 */
import { Router, type IRouter, type Request } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { calcWatchlistScore } from "../lib/scoreEngine";
import { logger } from "../lib/logger";
import { requireMember } from "../lib/auth";
import { nyDate } from "../lib/tradingDate";
import { sanitizeMultiLineUrls } from "../lib/safe-url";
import { AppError, badRequest, notFound, unauthorized } from "../lib/http";
import { watchActor, readWatchView } from "../lib/watchlist/access";
import { canReadRow, canWriteRow, canEditDesk, ownerOf, parseScope, readScope, type WatchActor, type WatchScope } from "../lib/watchlist/scope";
import * as store from "../lib/watchlist/store";
import type { ContentPatch, ListName, WatchRow } from "../lib/watchlist/store";
import viewRouter from "./watchlist-view";

const router: IRouter = Router();
router.use(viewRouter);

const STATUSES = new Set(["watching", "passed", "traded"]);
// Legacy rows were seeded with "Active"; treat it (and other casings) as "watching".
function normalizeStatus(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).trim().toLowerCase();
  if (s === "active") return "watching";
  return STATUSES.has(s) ? s : null;
}
function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
/** The field name when the price is not a non-negative number, else null. */
function invalidPrice(v: unknown, label: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n < 1e8 ? null : label;
}
function priceOrNull(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  return String(Number(String(v).replace(",", ".")));
}
/** «В игре» from a body: true/false (or "true"/"false"/1/0); undefined when absent; "invalid" otherwise. */
function parseInPlay(v: unknown): boolean | undefined | "invalid" {
  if (v === undefined) return undefined;
  if (v === true || v === "true" || v === 1 || v === "1") return true;
  if (v === false || v === "false" || v === 0 || v === "0" || v === null) return false;
  return "invalid";
}
const LISTS = new Set(["today", "swing", "watch"]);
function parseList(v: unknown): ListName | undefined | "invalid" {
  if (v === undefined || v === null || v === "") return undefined;
  const s = String(v).trim().toLowerCase();
  return LISTS.has(s) ? (s as ListName) : "invalid";
}

/** The signed-in member (401 / 403 GUEST_READ_ONLY for writes). */
async function writer(req: Request): Promise<WatchActor> {
  const a = await watchActor(req);
  if (!a) throw unauthorized();
  if (a.guest) throw new AppError("GUEST_READ_ONLY");
  return a;
}

/** The list a write goes to: body.scope (default the personal list); the desk list needs a senior / staff. */
function writeOwner(a: WatchActor, raw: unknown): number | null {
  const scope = parseScope(raw);
  if (scope === "invalid") throw new AppError("INVALID_FIELD", undefined, { field: "scope" });
  if (scope === "desk" && !canEditDesk(a)) throw new AppError("NOT_OWNER");
  return ownerOf(scope ?? "mine", a);
}

/** One row the caller may write: 404 when he may not even see it, 403 NOT_OWNER when it is a desk row he can't edit. */
async function writableRow(a: WatchActor, id: number): Promise<void> {
  const owners = await store.ownersOf([id]);
  if (!owners.has(id)) throw notFound();
  const owner = owners.get(id) ?? null;
  if (!canReadRow(a, owner)) throw notFound();
  if (!canWriteRow(a, owner)) throw new AppError("NOT_OWNER");
}

const scopeOf = (r: { owner: number | null }): WatchScope => (r.owner == null ? "desk" : "mine");
const out = (a: WatchActor, r: WatchRow) => ({ ...r, status: normalizeStatus(r.status) ?? r.status, scope: scopeOf(r), canEdit: canWriteRow(a, r.owner) });

router.get("/watchlist", asyncHandler(async (req, res): Promise<void> => {
  const a = await watchActor(req);
  if (!a) throw unauthorized();
  const asked = parseScope(req.query.scope);
  if (asked === "invalid") throw new AppError("INVALID_FIELD", undefined, { field: "scope" });
  const scope = readScope(asked, asked || a.guest ? "mine" : (await readWatchView(a.id)).scope, a);
  const rows = await store.listRows(ownerOf(scope, a));
  const tickers = Array.from(new Set(rows.map((r) => r.ticker.toUpperCase())));
  const stats = await store.tickerStats(tickers, a.guest ? null : a.name, a.role === "curator" || a.role === "admin");
  const today = nyDate();
  const list = rows.map((r) => {
    const t = r.ticker.toUpperCase();
    const ideas = stats.ideas.get(t);
    const trades = stats.trades.get(t);
    const open = stats.open.get(t);
    return {
      ...out(a, r),
      ideaCount: ideas?.count ?? 0,
      lastIdeaAt: ideas?.last ?? null,
      tradeCount: trades?.count ?? 0,
      lastTradeDate: trades?.last ?? null,
      openPositions: open?.count ?? 0,
      openTraders: open?.traders ?? [],
      openTradeIds: open?.ids ?? [],
      // «Торговал» today: the caller's own trades (the row status is not rewritten for everyone any more).
      tradedToday: trades?.last === today,
    };
  });
  const inPlayOnly = req.query.inPlay === "1" || req.query.inPlay === "today";
  res.json(inPlayOnly ? list.filter((r) => r.inPlay) : list);
}));

/**
 * POST /api/watchlist/bulk — { ids: number[], action, status?, inPlay?, list? }
 * Rows the caller may not write (another trader's list, a desk row without senior / staff) are skipped and reported in
 * `denied`; when nothing is left → 403 NOT_OWNER.
 */
router.post("/watchlist/bulk", asyncHandler(async (req, res): Promise<void> => {
  if (!requireMember(req, res)) return;
  const a = await writer(req);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const asked = Array.isArray(b.ids)
    ? Array.from(new Set(b.ids.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0)))
    : [];
  if (!asked.length) throw new AppError("IDS_REQUIRED");
  if (asked.length > 200) throw new AppError("TOO_MANY", undefined, { field: "ids", max: 200 });
  const action = String(b.action ?? "");
  if (!["status", "delete", "restore", "inplay", "list"].includes(action)) throw new AppError("INVALID_FIELD", undefined, { field: "action" });
  const owners = await store.ownersOf(asked);
  const ids = asked.filter((id) => owners.has(id) && canWriteRow(a, owners.get(id) ?? null));
  const denied = asked.filter((id) => owners.has(id) && !ids.includes(id));
  if (!ids.length) throw new AppError("NOT_OWNER", 403, undefined, { denied });

  if (action === "status") {
    const status = normalizeStatus(b.status);
    if (!status) throw new AppError("INVALID_FIELD", undefined, { field: "status" });
    res.json({ success: true, count: await store.setStatus(ids, status), denied });
    return;
  }
  if (action === "delete" || action === "restore") {
    const changed = await store.setDeleted(ids, action === "delete");
    res.json({ success: true, count: changed.length, ids: changed, denied });
    return;
  }
  if (action === "inplay") {
    const flag = parseInPlay(b.inPlay);
    if (flag === undefined || flag === "invalid") throw new AppError("INVALID_FIELD", undefined, { field: "inPlay" });
    res.json({ success: true, count: await store.setInPlay(ids, flag), denied });
    return;
  }
  const list = parseList(b.list);
  if (list === undefined || list === "invalid") throw new AppError("INVALID_FIELD", undefined, { field: "list" });
  res.json({ success: true, count: await store.setList(ids, list), denied });
}));

const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,11}$/;
const QUICK_MAX = 30;

/** Scores freshly quick-added rows after the response (bounded concurrency; the engine calls external APIs). */
function scoreInBackground(rows: { id: number; ticker: string }[]): void {
  if (!rows.length) return;
  const queue = [...rows];
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      try {
        const result = await calcWatchlistScore({ ticker: item.ticker, catalyst: null, sector: null });
        await store.setScore(item.id, result.total, JSON.stringify(result));
      } catch (err) {
        logger.warn({ err, id: item.id, ticker: item.ticker }, "watchlist quick-add: background score failed");
      }
    }
  };
  void Promise.all(Array.from({ length: Math.min(2, rows.length) }, worker));
}

/**
 * POST /api/watchlist/quick — { tickers: string[] (≤30), list?, scope? }
 * Fast multi-add: creates the missing tickers of the list without waiting for the score (scored in the background),
 * moves already active ones to `list`, brings archived («Пропустил») ones back.
 */
router.post("/watchlist/quick", asyncHandler(async (req, res): Promise<void> => {
  if (!requireMember(req, res)) return;
  const a = await writer(req);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const owner = writeOwner(a, b.scope);
  const raw = Array.isArray(b.tickers) ? b.tickers : typeof b.tickers === "string" ? b.tickers.split(/[\s,;]+/) : [];
  const list = parseList(b.list);
  if (list === "invalid") throw new AppError("INVALID_FIELD", undefined, { field: "list" });
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const v of raw) {
    const t = String(v ?? "").trim().toUpperCase().replace(/^\$/, "");
    if (!t || seen.has(t)) continue;
    seen.add(t);
    if (TICKER_RE.test(t)) valid.push(t); else invalid.push(t.slice(0, 16));
  }
  if (!valid.length) throw new AppError("INVALID_TICKER", 400, undefined, { invalid });
  if (valid.length > QUICK_MAX) throw new AppError("TOO_MANY", undefined, { field: "tickers", max: QUICK_MAX });

  const existingRows = await store.activeByTickers(valid, owner);
  const existing = existingRows.map((r) => ({ id: r.id, ticker: r.ticker }));
  const existingSet = new Set(existing.map((r) => r.ticker.toUpperCase()));
  const target: ListName = list ?? "watch";
  const created = await store.insertRows(
    valid.filter((t) => !existingSet.has(t)).map((ticker) => ({ ticker, status: "watching", createdBy: a.name })),
    owner,
    target,
  );
  // Re-adding an archived («Пропустил») ticker brings it back to the working lists.
  const restored = existingRows.filter((r) => r.status.toLowerCase() === "passed").map((r) => r.id);
  if (restored.length) await store.setStatus(restored, "watching");
  const moveIds = list ? existing.map((r) => r.id) : restored;
  if (moveIds.length) await store.setList(moveIds, target);
  scoreInBackground(created.map((r) => ({ id: r.id, ticker: r.ticker })));
  res.json({ created: created.map((r) => out(a, r)), moved: list ? existing : [], restored, existing, invalid });
}));

const numOrNull = (v: unknown) => (v !== undefined && v !== null && v !== "" ? String(v) : null);
const textOrNull = (v: unknown) => (v ? String(v) : null);

/** Content fields of a create / patch body (undefined = not named). */
function contentOf(b: Record<string, unknown>): ContentPatch {
  const p: ContentPatch = {};
  if (b.catalyst !== undefined) p.catalyst = textOrNull(b.catalyst);
  if (b.targetPrice !== undefined) p.targetPrice = priceOrNull(b.targetPrice);
  if (b.stopPrice !== undefined) p.stopPrice = priceOrNull(b.stopPrice);
  if (b.notes !== undefined) p.notes = textOrNull(b.notes);
  if (b.sector !== undefined) p.sector = textOrNull(b.sector);
  if (b.tags !== undefined) p.tags = textOrNull(b.tags);
  // The form's screenshot links (one per line, http(s) only — same cleaning as ideas / events).
  if (b.screenshotUrl !== undefined) p.screenshotUrl = sanitizeMultiLineUrls(typeof b.screenshotUrl === "string" ? b.screenshotUrl : null);
  for (const k of ["marketCap", "float", "adv", "longName"] as const) if (b[k] !== undefined) p[k] = textOrNull(b[k]);
  for (const k of ["atr", "relativeVolume", "beta", "shortInterest"] as const) if (b[k] !== undefined) p[k] = numOrNull(b[k]);
  return p;
}

router.post("/watchlist", asyncHandler(async (req, res): Promise<void> => {
  if (!requireMember(req, res)) return;
  const a = await writer(req);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const owner = writeOwner(a, b.scope);
  if (!b.ticker || !String(b.ticker).trim()) throw badRequest("TICKER_REQUIRED");
  const tickerUp = String(b.ticker).trim().toUpperCase();
  if (!TICKER_RE.test(tickerUp)) throw badRequest("INVALID_TICKER");
  if (b.status != null && b.status !== "" && !normalizeStatus(b.status)) throw new AppError("INVALID_FIELD", undefined, { field: "status" });
  // One active row per ticker in a list: point the client at the existing one instead of creating a duplicate.
  const [dup] = await store.activeByTickers([tickerUp], owner);
  if (dup) throw new AppError("ALREADY_IN_WATCHLIST", 409, { ticker: tickerUp }, { id: dup.id });
  const priceErr = invalidPrice(b.targetPrice, "targetPrice") ?? invalidPrice(b.stopPrice, "stopPrice");
  if (priceErr) throw new AppError("INVALID_FIELD", 400, { field: priceErr });
  const content = contentOf(b);
  let scored: { score: number; scoreBreakdown: string; scoredAt: Date } | null = null;
  try {
    const result = await calcWatchlistScore({ ticker: tickerUp, catalyst: content.catalyst ?? null, sector: content.sector ?? null });
    scored = { score: result.total, scoreBreakdown: JSON.stringify(result), scoredAt: new Date() };
  } catch (err) {
    logger.warn({ err, ticker: tickerUp }, "watchlist create: score calculation failed (will save without score)");
  }
  const list = parseList(b.list);
  const target: ListName = list && list !== "invalid" ? list : parseInPlay(b.inPlay) === true ? "today" : "watch";
  const [row] = await store.insertRows(
    [{ ...content, ticker: tickerUp, status: normalizeStatus(b.status) ?? "watching", createdBy: a.name, ...scored }],
    owner,
    target,
  );
  res.json(out(a, row!));
}));

router.patch("/watchlist/:id", asyncHandler(async (req, res): Promise<void> => {
  if (!requireMember(req, res)) return;
  const a = await writer(req);
  const id = parseId(String(req.params.id));
  if (id == null) throw badRequest("INVALID_ID");
  await writableRow(a, id);
  const b = (req.body ?? {}) as Record<string, unknown>;
  if (b.status != null && b.status !== "" && !normalizeStatus(b.status)) throw new AppError("INVALID_FIELD", undefined, { field: "status" });
  const current = await store.getRow(id);
  if (!current) throw notFound();
  const patch = contentOf(b);
  if (b.ticker && String(b.ticker).trim()) {
    const up = String(b.ticker).trim().toUpperCase();
    if (!TICKER_RE.test(up)) throw badRequest("INVALID_TICKER");
    const [dup] = await store.activeByTickers([up], current.owner);
    if (dup && dup.id !== id) throw new AppError("ALREADY_IN_WATCHLIST", 409, { ticker: up }, { id: dup.id });
    patch.ticker = up;
  }
  const priceErr = invalidPrice(b.targetPrice, "targetPrice") ?? invalidPrice(b.stopPrice, "stopPrice");
  if (priceErr) throw new AppError("INVALID_FIELD", 400, { field: priceErr });
  const inPlayFlag = parseInPlay(b.inPlay);
  if (inPlayFlag === "invalid") throw new AppError("INVALID_FIELD", undefined, { field: "inPlay" });
  const listFlag = parseList(b.list);
  if (listFlag === "invalid") throw new AppError("INVALID_FIELD", undefined, { field: "list" });
  const status = normalizeStatus(b.status);
  if (status) patch.status = status;

  let row = await store.updateContent(id, patch);
  if (!row) throw notFound();
  if (listFlag !== undefined) await store.setList([id], listFlag);
  else if (inPlayFlag !== undefined) await store.setInPlay([id], inPlayFlag);

  if (b.ticker !== undefined || b.catalyst !== undefined || b.sector !== undefined) {
    try {
      const result = await calcWatchlistScore({ ticker: row.ticker, catalyst: row.catalyst, sector: row.sector });
      row = (await store.setScore(id, result.total, JSON.stringify(result))) ?? row;
    } catch (err) {
      logger.warn({ err, id, ticker: row.ticker }, "watchlist patch: auto-recalc failed (returning row without rescored values)");
    }
  }
  if (listFlag !== undefined || inPlayFlag !== undefined) row = (await store.getRow(id)) ?? row;
  res.json(out(a, row));
}));

router.post("/watchlist/:id/score", asyncHandler(async (req, res): Promise<void> => {
  if (!requireMember(req, res)) return;
  const a = await writer(req);
  const id = parseId(String(req.params.id));
  if (id == null) throw badRequest("INVALID_ID");
  await writableRow(a, id);
  const item = await store.getRow(id);
  if (!item) throw notFound();
  const result = await calcWatchlistScore({ ticker: item.ticker, catalyst: item.catalyst, sector: item.sector });
  const updated = await store.setScore(id, result.total, JSON.stringify(result));
  res.json({ row: updated ? out(a, updated) : null, breakdown: result });
}));

const SCORE_ALL_MAX_ROWS = 300;
const SCORE_ALL_WORKERS = 4;
const scoreAllRunning = new Set<string>();

/** POST /api/watchlist/score-all?scope= — rescores one list the caller may write (default: his own). */
router.post("/watchlist/score-all", asyncHandler(async (req, res): Promise<void> => {
  if (!requireMember(req, res)) return;
  const a = await writer(req);
  const owner = writeOwner(a, req.query.scope ?? (req.body as { scope?: unknown } | undefined)?.scope);
  const key = owner == null ? "desk" : String(owner);
  if (scoreAllRunning.has(key)) throw new AppError("SYNC_RUNNING");
  scoreAllRunning.add(key);
  try {
    const rows = await store.rowsToScore(owner, SCORE_ALL_MAX_ROWS);
    let count = 0;
    const failures: { id: number; ticker: string; error: string }[] = [];
    // Bounded concurrency: 4 workers over a shared queue (the score engine hits external APIs).
    const queue = [...rows];
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        try {
          const result = await calcWatchlistScore({ ticker: item.ticker, catalyst: item.catalyst, sector: item.sector });
          await store.setScore(item.id, result.total, JSON.stringify(result));
          count++;
        } catch (err) {
          logger.warn({ err, id: item.id, ticker: item.ticker }, "watchlist score-all: failed for one row (continuing)");
          failures.push({ id: item.id, ticker: item.ticker, error: err instanceof Error ? err.message : String(err) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(SCORE_ALL_WORKERS, rows.length) }, worker));
    res.json({ success: true, count, failed: failures.length, failures, truncated: rows.length === SCORE_ALL_MAX_ROWS });
  } finally {
    scoreAllRunning.delete(key);
  }
}));

router.delete("/watchlist/:id", asyncHandler(async (req, res): Promise<void> => {
  if (!requireMember(req, res)) return;
  const a = await writer(req);
  const id = parseId(String(req.params.id));
  if (id == null) throw badRequest("INVALID_ID");
  await writableRow(a, id);
  await store.setDeleted([id], true);
  res.json({ success: true });
}));

router.post("/watchlist/:id/restore", asyncHandler(async (req, res): Promise<void> => {
  if (!requireMember(req, res)) return;
  const a = await writer(req);
  const id = parseId(String(req.params.id));
  if (id == null) throw badRequest("INVALID_ID");
  await writableRow(a, id);
  await store.setDeleted([id], false);
  res.json({ success: true });
}));

export default router;
