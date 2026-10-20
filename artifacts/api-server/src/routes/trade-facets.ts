/**
 * «Улучшенный поиск» — the PropReports-style «Фильтры» panel of /trades and /stats (lib/tradeFacetsSql, lib/tradeFacetsQuery).
 *
 *   GET /trades/facets       the same query as /trades/page (from, to, trader, outcome, setup… + xYears / xMonths / xDays /
 *                            xTimes / xStrategies / xTypes / xGtags / xPtags = excluded keys, excludeImx=1)
 *     → { dims: { years|months|days|times|strategies|types|gtags|ptags: [{ key, label, count, net }] },
 *         total: { count, net }, imx: { count, net }, excludeImx, money, deskTags }
 *       Each column is counted with its own exclusion ignored; `imx` = the IMX part of the selection (strategy MOC),
 *       also while «Исключить IMX» is on. Scope as /trades/page (lib/auth scopeTrader: a member reads only the own
 *       book, staff may pass ?trader=); $ of a book the viewer may not see are null (`money: false`).
 *   GET /trades/facets/view  the viewer's saved panel { off, excludeImx, open } (users.settings.tradesFacetView)
 *   PUT /trades/facets/view  member — any of { off, excludeImx, open } → the saved view
 *
 * Mounted from routes/trades.ts BEFORE /trades/:id (one line there).
 */
import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { isGuestUser, scopeTrader } from "../lib/auth";
import { AppError, unauthorized } from "../lib/http";
import { loadMoneyViewer } from "../lib/playbookAccess";
import { canSeeBookMoney } from "../lib/playbookPrivacy";
import { compactQuery, moneyBlindFilters, pageFiltersOf, TradesPageQuery } from "../lib/tradesPageParams";
import { DESK_TAGS } from "../lib/deskTags";
import { FACET_DIMS, NONE_KEY, TIME_BUCKETS, UNKNOWN_KEY, type FacetDim } from "../lib/tradeFacetsSql";
import { buildFacetsQuery, foldFacets, type FacetBucketRow } from "../lib/tradeFacetsQuery";
import { DEFAULT_FACET_VIEW, normalizeFacetView, readFacetView, writeFacetView } from "../lib/tradeFacetsView";
import { insightsT } from "../i18n/ns";
import { langOf, type Lang } from "../i18n";
import { localeTagFor } from "../i18n/core";

const router: IRouter = Router();

// trade_quality comes from the migrations; probed (cached a minute) — quality filters join it.
let qualityCheck: { ok: boolean; exp: number } | null = null;
async function qualityTableExists(): Promise<boolean> {
  const now = Date.now();
  if (qualityCheck && qualityCheck.exp > now) return qualityCheck.ok;
  try {
    const { rows } = await pool.query<{ ok: boolean }>(`SELECT to_regclass('public.trade_quality') IS NOT NULL AS ok`);
    qualityCheck = { ok: Boolean(rows[0]?.ok), exp: now + 60_000 };
  } catch {
    qualityCheck = { ok: false, exp: now + 10_000 };
  }
  return qualityCheck.ok;
}

const TIME_ORDER = [...TIME_BUCKETS.map((b) => b.key), UNKNOWN_KEY];

/** Bucket names in the reader's language (strategy codes, years and tags are data and stay as they are). */
export function facetLabeler(lang: Lang): (dim: FacetDim, key: string) => string {
  const t = insightsT.tFor(lang);
  const tag = localeTagFor(lang);
  const month = new Intl.DateTimeFormat(tag, { month: "short", timeZone: "UTC" });
  const weekday = new Intl.DateTimeFormat(tag, { weekday: "short", timeZone: "UTC" });
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return (dim, key) => {
    if (key === UNKNOWN_KEY) return t("facet.unknown");
    if (key === NONE_KEY) return t("facet.none");
    const n = Number(key);
    if (dim === "months" && n >= 1 && n <= 12) return cap(month.format(new Date(Date.UTC(2024, n - 1, 1))));
    // 2024-01-01 is a Monday: ISO weekday n → Jan n.
    if (dim === "days" && n >= 1 && n <= 7) return cap(weekday.format(new Date(Date.UTC(2024, 0, n))));
    if (dim === "times") return key === "before-8:30" ? t("facet.time.before") : key === "after-16:00" ? t("facet.time.after") : key.replace("-", "–");
    if (dim === "types") return key === "long" ? t("facet.type.long") : key === "short" ? t("facet.type.short") : key;
    return key;
  };
}

router.get("/trades/facets", asyncHandler(async (req, res): Promise<void> => {
  const parsed = TradesPageQuery.safeParse(compactQuery(req.query as Record<string, unknown>));
  if (!parsed.success) throw parsed.error;
  const q = parsed.data;
  const scope = await scopeTrader(req, q.trader);
  if (scope === undefined) throw unauthorized();
  const showMoney = canSeeBookMoney(await loadMoneyViewer(req), scope);
  const filters = moneyBlindFilters(pageFiltersOf(q, scope), showMoney);
  filters.facets ??= { off: {}, excludeImx: false, deskTags: DESK_TAGS };
  const quality = await qualityTableExists();
  const { sql, params } = buildFacetsQuery(filters, quality);
  const { rows } = await pool.query<FacetBucketRow>(sql, params);
  res.setHeader("Cache-Control", "private, no-cache");
  res.json({
    ...foldFacets(rows, facetLabeler(langOf(req)), showMoney, TIME_ORDER),
    excludeImx: filters.facets.excludeImx,
    money: showMoney,
    deskTags: DESK_TAGS,
  });
}));

function member(req: Request): number {
  const u = req.authUser;
  if (!u) throw unauthorized();
  if (isGuestUser(u)) throw new AppError("GUEST_READ_ONLY");
  return u.id;
}

router.get("/trades/facets/view", asyncHandler(async (req, res): Promise<void> => {
  const u = req.authUser;
  if (!u) throw unauthorized();
  res.json(isGuestUser(u) ? DEFAULT_FACET_VIEW : await readFacetView(u.id));
}));

const KeyList = z.array(z.string().trim().min(1).max(120)).max(300);
const ViewBody = z.object({
  off: z.object(Object.fromEntries(FACET_DIMS.map((d) => [d, KeyList.optional()])) as Record<FacetDim, z.ZodOptional<typeof KeyList>>).optional(),
  excludeImx: z.boolean().optional(),
  open: z.boolean().optional(),
});

router.put("/trades/facets/view", asyncHandler(async (req, res): Promise<void> => {
  const id = member(req);
  const body = ViewBody.safeParse(req.body ?? {});
  if (!body.success) throw body.error;
  const current = await readFacetView(id);
  const b = body.data;
  res.json(await writeFacetView(id, normalizeFacetView({
    off: b.off !== undefined ? b.off : current.off,
    excludeImx: b.excludeImx ?? current.excludeImx,
    open: b.open ?? current.open,
  })));
}));

export default router;
