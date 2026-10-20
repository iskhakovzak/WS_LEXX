/**
 * Market themes («Темы рынка», lib/themes/*): TradingView-style theme tracker.
 *
 *   GET  /api/themes            BoardResponse — the shared board + the viewer's view and boards (guests: base only)
 *   PUT  /api/themes/view       member — any of { columns: metric[] (≥ 1), hidden: baseThemeId[], sort, tab } → ThemesView
 *                               (merged into users.settings.themesView, follows the user across devices)
 *   POST /api/themes/mine       member — personal theme { boardId, name, kind: tickers | screener, tickers? | screener?, order? }
 *                               on one of the user's themes boards (routes/themes-boards.ts)
 *   PUT  /api/themes/mine/:id   member, owner only — the same fields, or { active: false } to archive
 *   GET  /api/themes/config     admin (settings.manage) — every shared theme incl. archived ({ themes: ThemeRecord[] })
 *   POST /api/themes            admin — { name, tickers, sortOrder?, active? } → ThemeRecord
 *   PUT  /api/themes/:id        admin — any of { name, tickers, sortOrder, active } → ThemeRecord (archive = active false)
 *
 * Shared themes are desk-wide settings: settings.manage (adminOnly), like the other desk settings. Tickers are
 * upper-cased, `$` dropped, de-duplicated; 1–30 of /^[A-Z.\-]{1,10}$/. A screener is a Finviz URL / f= query / filter
 * list: only its f / o values are kept (lib/themes/personal parseScreenerInput — an auth token is never stored or
 * echoed). ≤ 10 personal themes per user. Every write is in the audit log. Nothing is deleted.
 */
import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { idParam, notFound, AppError, route, unauthorized } from "../lib/http";
import { isGuestUser } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { MAX_THEME_TICKERS, THEME_METRICS, THEME_TICKER_RE } from "../lib/themes/logic";
import { getBoard, refreshScreener } from "../lib/themes/board";
import { MAX_HIDDEN, MAX_PERSONAL_THEMES, normalizeView, parseScreenerInput, type ScreenerSpec } from "../lib/themes/personal";
import { boardById } from "../lib/themes/boardsStore";
import { countPersonal, insertPersonal, personalById, readView, updatePersonal, writeView, type PersonalRecord } from "../lib/themes/personalStore";
import { insertTheme, listThemes, themeById, updateTheme, type ThemePatch } from "../lib/themes/store";

const router: IRouter = Router();

/** Desk-wide theme baskets = desk settings (admin). */
const ADMIN = "settings.manage" as const;
/** Create / edit waits this long for a screener's first resolve, then answers (the board shows it when ready). */
const RESOLVE_WAIT_MS = 8_000;

const Name = z.string().trim().min(1).max(60);
const Tickers = z
  .array(z.string().max(12))
  .max(MAX_THEME_TICKERS * 2)
  .transform((list) => [...new Set(list.map((s) => s.trim().toUpperCase().replace(/^\$/, "")).filter(Boolean))])
  .pipe(z.array(z.string().regex(THEME_TICKER_RE, "ticker: A–Z . - (≤ 10)")).min(1).max(MAX_THEME_TICKERS));
const SortOrder = z.number().int().min(0).max(1_000_000);

const Fields = z.object({
  name: Name.optional(),
  tickers: Tickers.optional(),
  sortOrder: SortOrder.optional(),
  sort_order: SortOrder.optional(),
  active: z.boolean().optional(),
});

const toPatch = ({ sort_order, sortOrder, ...rest }: z.infer<typeof Fields>): ThemePatch => ({ ...rest, sortOrder: sortOrder ?? sort_order });

const CreateBody = Fields.extend({ name: Name, tickers: Tickers }).transform(toPatch);
const UpdateBody = Fields.transform(toPatch);

/** The signed-in member (guests have no users row: read-only). */
function member(req: Request): { id: number; name: string } {
  const u = req.authUser;
  if (!u) throw unauthorized();
  if (isGuestUser(u)) throw new AppError("GUEST_READ_ONLY");
  return { id: u.id, name: u.name };
}

const viewer = (req: Request): number | null => (req.authUser && !isGuestUser(req.authUser) ? req.authUser.id : null);

router.get("/themes", route({}, async ({ req }) => getBoard(viewer(req))));

// ─── per-user view ────────────────────────────────────────────────────────────

const ViewBody = z.object({
  columns: z.array(z.enum(THEME_METRICS)).min(1).max(THEME_METRICS.length).optional(),
  hidden: z.array(z.number().int().positive()).max(MAX_HIDDEN).optional(),
  sort: z.object({ col: z.enum(THEME_METRICS), dir: z.enum(["desc", "asc"]) }).nullable().optional(),
  tab: z.union([z.literal("shared"), z.number().int().positive()]).optional(),
});

router.put("/themes/view", route({ body: ViewBody }, async ({ req, body }) => {
  const me = member(req);
  const current = await readView(me.id);
  const next = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
  return writeView(me.id, normalizeView({ ...current, ...next }));
}));

// ─── «Мои темы» ───────────────────────────────────────────────────────────────

const MineFields = z.object({
  /** The themes board it sits on (one of the caller's). */
  boardId: idParam,
  name: Name,
  kind: z.enum(["tickers", "screener"]),
  tickers: Tickers.optional(),
  /** Finviz screener URL, "f=…&o=…" or a filter list. */
  screener: z.string().trim().max(2000).optional(),
  order: z.string().trim().max(41).nullable().optional(),
});
const MineUpdate = MineFields.omit({ boardId: true }).partial().extend({ active: z.boolean().optional() });

/** kind + raw fields → a checked definition (400 VALIDATION with the field when something is missing / invalid). */
function definition(kind: "tickers" | "screener", body: { tickers?: string[]; screener?: string; order?: string | null }): { tickers: string[]; screener: ScreenerSpec | null } {
  if (kind === "tickers") {
    if (!body.tickers?.length) throw new AppError("VALIDATION", 400, undefined, [{ path: "body.tickers", message: "1–30 tickers" }]);
    return { tickers: body.tickers, screener: null };
  }
  const parsed = parseScreenerInput(body.screener ?? "", body.order);
  if (!parsed.ok) throw new AppError("VALIDATION", 400, undefined, [{ path: "body.screener", message: parsed.reason }]);
  return { tickers: [], screener: parsed.spec };
}

/** What the API answers about a personal theme (the board carries the moves). */
const mineOut = (r: PersonalRecord) => ({
  id: r.id, boardId: r.boardId, name: r.name, kind: r.kind, tickers: r.tickers, screener: r.screener, resolvedTickers: r.resolvedTickers, active: r.active,
});

async function resolveSoon(r: PersonalRecord): Promise<PersonalRecord> {
  if (r.kind !== "screener") return r;
  await Promise.race([refreshScreener(r), new Promise((res) => setTimeout(res, RESOLVE_WAIT_MS).unref?.())]);
  return r;
}

router.post("/themes/mine", route({ body: MineFields }, async ({ req, body }) => {
  const me = member(req);
  const board = await boardById(me.id, body.boardId);
  if (!board || !board.active || board.kind !== "themes") throw notFound("BOARD_NOT_FOUND");
  if ((await countPersonal(me.id)) >= MAX_PERSONAL_THEMES) throw new AppError("THEME_LIMIT", undefined, { max: MAX_PERSONAL_THEMES });
  const def = definition(body.kind, body);
  const created = await resolveSoon(await insertPersonal(me.id, { name: body.name, kind: body.kind, ...def, boardId: board.id }));
  await logAudit({ actor: me.name, action: "themes.mine.create", targetType: "user_theme", targetId: String(created.id), details: { name: created.name, kind: created.kind } });
  return mineOut(created);
}));

router.put("/themes/mine/:id", route({ params: z.object({ id: idParam }), body: MineUpdate }, async ({ req, params, body }) => {
  const me = member(req);
  const current = await personalById(me.id, params.id);
  if (!current) throw notFound("THEME_NOT_FOUND");
  if (body.active === true && !current.active && (await countPersonal(me.id)) >= MAX_PERSONAL_THEMES) {
    throw new AppError("THEME_LIMIT", undefined, { max: MAX_PERSONAL_THEMES });
  }
  const kind = body.kind ?? current.kind;
  const definitionChanged = body.kind !== undefined || body.tickers !== undefined || body.screener !== undefined || body.order !== undefined;
  const def = definitionChanged
    ? definition(kind, {
      tickers: body.tickers ?? (kind === current.kind ? current.tickers : undefined),
      screener: body.screener ?? (kind === current.kind && current.screener ? current.screener.filters.join(",") : undefined),
      order: body.order !== undefined ? body.order : current.screener?.order ?? null,
    })
    : {};
  const updated = await updatePersonal(me.id, params.id, { name: body.name, kind, ...def, active: body.active }, current);
  if (!updated) throw notFound("THEME_NOT_FOUND");
  const out = updated.active ? await resolveSoon(updated) : updated;
  const action = body.active === false && current.active ? "themes.mine.archive" : "themes.mine.update";
  await logAudit({ actor: me.name, action, targetType: "user_theme", targetId: String(out.id), details: { name: out.name, kind: out.kind } });
  return mineOut(out);
}));

// ─── shared themes (admin) ────────────────────────────────────────────────────

router.get("/themes/config", route({ cap: ADMIN }, async () => ({ themes: await listThemes(true) })));

router.post("/themes", route({ cap: ADMIN, body: CreateBody }, async ({ body, actor }) => {
  const created = await insertTheme({ name: body.name!, tickers: body.tickers!, sortOrder: body.sortOrder, active: body.active }, actor.name);
  await logAudit({ actor: actor.name, action: "themes.create", targetType: "market_theme", targetId: String(created.id), details: { after: created } });
  return created;
}));

router.put("/themes/:id", route({ cap: ADMIN, params: z.object({ id: idParam }), body: UpdateBody }, async ({ params, body, actor }) => {
  if (Object.values(body).every((v) => v === undefined)) throw new AppError("NO_FIELDS");
  const before = await themeById(params.id);
  if (!before) throw notFound("THEME_NOT_FOUND");
  const after = await updateTheme(params.id, body, actor.name);
  if (!after) throw notFound("THEME_NOT_FOUND");
  const action = body.active === false && before.active ? "themes.archive" : body.active === true && !before.active ? "themes.restore" : "themes.update";
  await logAudit({ actor: actor.name, action, targetType: "market_theme", targetId: String(after.id), details: { before, after } });
  return after;
}));

export default router;
