/**
 * Market themes («Темы рынка», lib/themes/*): TradingView-style theme tracker.
 *
 *   GET  /api/themes          ThemesResponse — any signed-in member (global auth gate); quotes refresh lazily
 *   GET  /api/themes/config   staff — every theme incl. archived ({ themes: ThemeRecord[] })
 *   POST /api/themes          staff — { name, tickers, sortOrder?, active? } → ThemeRecord
 *   PUT  /api/themes/:id      staff — any of { name, tickers, sortOrder, active } → ThemeRecord (archive = active false)
 *
 * Staff = gameplan.publish or dailyfeed.manage (the desk-content caps, as POST /finviz/refresh). Tickers are
 * upper-cased, `$` dropped, de-duplicated; 1–30 of /^[A-Z.\-]{1,10}$/. `sort_order` is accepted as an alias of
 * sortOrder. Every write is in the audit log. Nothing is deleted.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { idParam, notFound, AppError, route } from "../lib/http";
import { logAudit } from "../lib/audit";
import { MAX_THEME_TICKERS, THEME_TICKER_RE } from "../lib/themes/logic";
import { getThemes } from "../lib/themes/service";
import { insertTheme, listThemes, themeById, updateTheme, type ThemePatch } from "../lib/themes/store";

const router: IRouter = Router();

const STAFF = ["gameplan.publish", "dailyfeed.manage"] as const;

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

router.get("/themes", route({}, async () => getThemes()));

router.get("/themes/config", route({ cap: STAFF }, async () => ({ themes: await listThemes(true) })));

router.post("/themes", route({ cap: STAFF, body: CreateBody }, async ({ body, actor }) => {
  const created = await insertTheme({ name: body.name!, tickers: body.tickers!, sortOrder: body.sortOrder, active: body.active }, actor.name);
  await logAudit({ actor: actor.name, action: "themes.create", targetType: "market_theme", targetId: String(created.id), details: { after: created } });
  return created;
}));

router.put("/themes/:id", route({ cap: STAFF, params: z.object({ id: idParam }), body: UpdateBody }, async ({ params, body, actor }) => {
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
