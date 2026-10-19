/**
 * Gamification (owner 2026-10-18: «чтобы интерес был лучше и награды»). Logic: lib/gamification/*; shapes:
 * lib/gamification/types.ts. Never rewards P&L, trade count or time in the app.
 *
 *   GET  /api/gamification/me[?trader=]          GamificationMe (staff: journal.review on the trader)
 *   GET  /api/gamification/season[?key=YYYY-MM]  SeasonState (top N + the viewer's place; aliases for traders)
 *   GET  /api/gamification/league[?key=]         LeagueState (+ members of the curator's own team)
 *   PUT  /api/gamification/title {key|null}      the trader's active title (must be earned)
 *   GET  /api/gamification/titles                { titles: { name: titleKey } } — active titles of everyone who shares
 *   GET  /api/gamification/rewards/items         admin (settings.manage): { items, pending, stats, recent, options }
 *                                                (options.achievements[].targets = each tier's target, for the editor)
 *   POST /api/gamification/rewards/items         admin: a catalog item (RewardItem minus id)
 *   PUT  /api/gamification/rewards/items/:id     admin: replace an item (deactivated → open eligibility revoked;
 *                                                condition changed → eligible traders re-checked)
 *   POST /api/gamification/rewards/items/:id/request   the trader requests an eligible reward
 *   GET  /api/gamification/rewards/queue         staff (journal.review): { grants } requested by the traders they manage
 *                                                (admin: everyone; curator: own traders)
 *   POST /api/gamification/rewards/grants/:id/grant | /decline {note?}   the trader's curator or an admin
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { AppError, assertCap, idParam, notFound, route } from "../lib/http";
import { setting } from "../lib/settings/registry";
import { nyDate } from "../lib/tradingDate";
import { isStaffRoleName } from "../lib/accessRules";
import { levelThresholds } from "../lib/daily/discipline";
import { LINES, TIERS, type AchievementInput } from "../lib/quests/achievements";
import { requiredOnboardingSteps } from "../lib/quests/catalog";
import { spaceSql } from "../lib/playbookAccess";
import { codeFromName } from "../lib/playbookToday/build";
import { isSeasonKey } from "../lib/gamification/season";
import { eligibilityInputOf, gamificationMe, leagueState, seasonState } from "../lib/gamification/service";
import { hiddenUsers, participants, setChosenTitle, userInfo } from "../lib/gamification/people";
import { activeTitles, earnedTitles } from "../lib/gamification/titlesStore";
import { itemProblem } from "../lib/gamification/rewards";
import { decideReward, recheckItem, requestReward } from "../lib/gamification/rewardsService";
import {
  grantById, insertItem, itemById, listItems, pendingCount, recentGranted, requestedGrants, rewardStats, updateItem,
} from "../lib/gamification/rewardsStore";
import type { RewardItem } from "../lib/gamification/types";

const router: IRouter = Router();

const seasonQuery = z.object({ key: z.string().refine(isSeasonKey, "season key YYYY-MM").optional() });
const me = (req: { authUser?: { name?: string } }) => req.authUser?.name ?? "";

router.get("/gamification/me", route({ query: z.object({ trader: z.string().trim().min(1).max(100).optional() }) }, async ({ req, query }) => {
  const actor = await assertCap(req, "trades.read.own", { trader: me(req) });
  const staff = isStaffRoleName(actor.role);
  if (query.trader && query.trader !== actor.name) {
    await assertCap(req, "journal.review", { trader: query.trader });
    const u = await userInfo(query.trader);
    if (!u) throw notFound("TRADER_NOT_FOUND");
    return gamificationMe({ subject: query.trader, staff }, { isTrader: u.role === "trader" });
  }
  return gamificationMe({ subject: actor.name, staff }, { isTrader: actor.role === "trader" });
}));

router.get("/gamification/season", route({ query: seasonQuery }, async ({ req, query }) => {
  const actor = await assertCap(req, "trades.read.own", { trader: me(req) });
  return seasonState({ subject: actor.name, staff: isStaffRoleName(actor.role) }, query.key ?? null);
}));

router.get("/gamification/league", route({ query: seasonQuery }, async ({ req, query }) => {
  const actor = await assertCap(req, "trades.read.own", { trader: me(req) });
  const out = await leagueState({ subject: actor.name, staff: isStaffRoleName(actor.role) }, query.key ?? null);
  return out ?? { season: query.key ?? null, teams: [] };
}));

router.put("/gamification/title", route({ body: z.object({ key: z.string().trim().min(1).max(60).nullable() }) }, async ({ req, body }) => {
  const actor = await assertCap(req, "trades.read.own", { trader: me(req) });
  if (!setting("gamification.enabled")) throw new AppError("GAMIFICATION_DISABLED");
  if (body.key) {
    const earned = (await earnedTitles([actor.name])).get(actor.name) ?? [];
    if (!earned.some((t) => t.key === body.key)) throw new AppError("TITLE_NOT_EARNED");
  }
  await setChosenTitle(actor.name, body.key);
  return { activeTitle: body.key };
}));

router.get("/gamification/titles", route({}, async ({ req }) => {
  await assertCap(req, "trades.read.own", { trader: me(req) });
  const titles = await activeTitles();
  const hidden = await hiddenUsers([...titles.keys()]);
  return { titles: Object.fromEntries([...titles].filter(([name]) => !hidden.has(name))) };
}));

// ─── rewards catalog (admin) ────────────────────────────────────────────────

const ItemBody = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  condition: z.object({
    kind: z.enum(["achievement", "level", "season_rank", "mastery"]),
    ref: z.string().trim().max(60).default(""),
    tier: z.string().trim().max(20).nullable().optional(),
    rank: z.number().int().nullable().optional(),
  }),
  active: z.boolean().default(false),
  stock: z.number().int().nullable().optional(),
});

/** The line's tier targets in order (settings now; function lines with today's onboarding size). */
function lineTargets(def: (typeof LINES)[number]): number[] {
  return typeof def.targets === "function"
    ? def.targets({ onboarding: { done: 0, total: requiredOnboardingSteps(), doneOn: null } } as AchievementInput)
    : def.targets.map((k) => Number(setting(k)));
}

function lineTierNames(def: (typeof LINES)[number]): string[] {
  return [...(def.tiers ?? TIERS)].slice(0, lineTargets(def).length);
}

function checkedItem(body: z.infer<typeof ItemBody>): Omit<RewardItem, "id"> {
  const item: Omit<RewardItem, "id"> = {
    title: body.title, description: body.description ?? null, active: body.active, stock: body.stock ?? null,
    condition: { kind: body.condition.kind, ref: body.condition.ref ?? "", tier: body.condition.tier ?? null, rank: body.condition.rank ?? null },
  };
  const problem = itemProblem(item, { lines: LINES.map((l) => l.id), levels: levelThresholds().length - 1 });
  if (problem) throw new AppError("REWARD_ITEM_INVALID", undefined, { field: problem });
  return item;
}

async function officeSetups(): Promise<{ id: number; code: string | null; name: string }[]> {
  const { rows } = await pool
    .query<{ id: number; name: string }>(`SELECT p.id, p.name FROM playbook p WHERE p.deleted_at IS NULL AND ${spaceSql("p")} = 'office' ORDER BY p.name`)
    .catch(() => ({ rows: [] as { id: number; name: string }[] }));
  return rows.map((r) => ({ id: Number(r.id), code: codeFromName(r.name), name: String(r.name) }));
}

router.get("/gamification/rewards/items", route({ cap: "settings.manage" }, async () => {
  const [items, pending, setups, stats, recent] = await Promise.all([
    listItems(), pendingCount(), officeSetups(), rewardStats(`${nyDate().slice(0, 7)}-01`), recentGranted(5),
  ]);
  return {
    items, pending, stats, recent,
    options: { achievements: LINES.map((l) => ({ id: l.id, tiers: lineTierNames(l), targets: lineTargets(l) })), levels: levelThresholds().length - 1, setups },
  };
}));

router.post("/gamification/rewards/items", route({ cap: "settings.manage", body: ItemBody }, async ({ actor, body }) => {
  return insertItem(checkedItem(body), actor!.name);
}));

router.put("/gamification/rewards/items/:id", route({ cap: "settings.manage", params: z.object({ id: idParam }), body: ItemBody }, async ({ actor, params, body }) => {
  const item = checkedItem(body);
  const before = await itemById(params.id);
  const out = await updateItem(params.id, item, actor!.name);
  if (!out) throw notFound("REWARD_ITEM_NOT_FOUND");
  await recheckItem(before, out, (trader) => eligibilityInputOf(trader));
  return out;
}));

// ─── rewards flow ───────────────────────────────────────────────────────────

router.post("/gamification/rewards/items/:id/request", route({ params: z.object({ id: idParam }) }, async ({ req, params }) => {
  const actor = await assertCap(req, "trades.read.own", { trader: me(req) });
  if (!setting("gamification.enabled")) throw new AppError("GAMIFICATION_DISABLED");
  const item = await itemById(params.id);
  if (!item || !item.active) throw notFound("REWARD_ITEM_NOT_FOUND");
  const grant = await requestReward(actor.name, item);
  if (!grant) throw new AppError("REWARD_NOT_ELIGIBLE");
  return { grant };
}));

router.get("/gamification/rewards/queue", route({ cap: "journal.review" }, async ({ actor }) => {
  if (actor!.role === "admin") return { grants: await requestedGrants(null) };
  const own = (await participants()).filter((p) => p.curator === actor!.name).map((p) => p.name);
  return { grants: await requestedGrants(own) };
}));

const DecideBody = z.object({ note: z.string().trim().max(500).nullable().optional() });

for (const action of ["grant", "decline"] as const) {
  router.post(`/gamification/rewards/grants/:id/${action}`, route({ params: z.object({ id: idParam }), body: DecideBody }, async ({ req, params, body }) => {
    const grant = await grantById(params.id);
    if (!grant) throw notFound("REWARD_GRANT_NOT_FOUND");
    const actor = await assertCap(req, "journal.review", { trader: grant.trader });
    if (actor.role !== "admin" && (await userInfo(grant.trader))?.curator !== actor.name) throw new AppError("REWARD_NOT_YOUR_TRADER");
    const d = await decideReward(grant, action === "grant" ? "granted" : "declined", actor.name, body.note || null);
    if (!d.ok) throw new AppError(d.code);
    return { grant: d.grant };
  }));
}

export default router;
