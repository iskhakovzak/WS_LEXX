/**
 * «Лёгкие деньги дня» (lib/deskPulse/easyMoney + easyStore): the clean moves the archived day shows for the in-play
 * tickers, matched against the group's plans and PropReports trades. Nothing is typed in except the plan notes.
 *
 *   GET /easy-money/me?date=&trader=      own lines (staff: a trader's with trades.read.team) — took / against /
 *                                          skipped / the biggest missed; the default day is the last closed session
 *   GET /easy-money/group?date=&scope=    curators / admins (trades.read.team: «Моя группа / Все») and seniors by ladder
 *                                          stage (their desk group): every move with who planned and traded it, who
 *                                          planned and skipped, who missed it; the viewer's own plan notes. A senior
 *                                          sees the other people's lines without $ (lib/moneyVisibility). Anyone else
 *                                          gets { allowed: false } (the board is not shown)
 *   PUT /easy-money/note                   the same viewers: { date, ticker, note } — a note in their OWN plan (empty
 *                                          = removed)
 */
import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { personalTrader } from "../lib/auth";
import { AppError, forbidden, route, unauthorized } from "../lib/http";
import { can, resolveActor } from "../lib/permissions";
import { loadRoster } from "../lib/curatorRoster";
import { stageOf } from "../lib/people/stage";
import { nyDate, nyMinutes } from "../lib/tradingDate";
import { isMarketClosed } from "../lib/marketDays";
import { prevSessionDay } from "../lib/catalyst/store";
import { normTicker } from "../lib/catalyst/model";
import { redactOthersMoney } from "../lib/moneyVisibility";
import { easyCfg, easyMoneyFor, NOTE_MAX, notesOf, personalEasyMoney, saveNote } from "../lib/deskPulse/easyStore";

const router: IRouter = Router();
const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** The session counts as closed a few minutes after 16:00 NY (the last prints settle). */
const CLOSED_AFTER_MIN = 16 * 60 + 5;

/** The last closed NY session: today after the close, else the session before. */
export async function lastClosedDay(now: Date = new Date()): Promise<string> {
  const today = nyDate(now);
  if (nyMinutes(now) >= CLOSED_AFTER_MIN && !(await isMarketClosed(today))) return today;
  return prevSessionDay(today);
}

async function memberOf(req: Request) {
  const a = await resolveActor(req);
  if (!a) throw unauthorized();
  if (a.guest) throw new AppError("GUEST_READ_ONLY");
  return a;
}

/** Active traders of the viewer's own desk group (a senior's group), the viewer included. */
async function ownGroup(name: string): Promise<string[]> {
  const { rows } = await pool.query<{ name: string }>(
    `SELECT u.name FROM users u
      WHERE u.active = true AND COALESCE(u.banned, false) = false AND u.role = 'trader'
        AND u.group_id IS NOT NULL AND u.group_id = (SELECT group_id FROM users WHERE name = $1 LIMIT 1)`,
    [name],
  ).catch(() => ({ rows: [] as { name: string }[] }));
  return [...new Set([name, ...rows.map((r) => r.name)])].sort((a, b) => a.localeCompare(b, "ru"));
}

/** Who may see the group board: staff (curator / admin) or a senior. */
async function boardViewer(req: Request): Promise<{ name: string; staff: boolean } | null> {
  const a = await memberOf(req);
  if (await can(req, "trades.read.team")) return { name: a.name, staff: true };
  return (await stageOf(a.name)) === "senior" ? { name: a.name, staff: false } : null;
}

router.get("/easy-money/me", route({
  query: z.object({ date: YMD.optional(), trader: z.string().trim().max(120).optional() }),
}, async ({ req, query }) => {
  const trader = await personalTrader(req, query.trader, "trades.read.team");
  return { trader, ...(await personalEasyMoney(trader, query.date ?? (await lastClosedDay()))) };
}));

router.get("/easy-money/group", route({
  query: z.object({ date: YMD.optional(), scope: z.enum(["group", "all", "mine", "desk"]).optional() }),
}, async ({ req, query }) => {
  const v = await boardViewer(req);
  if (!v) return { allowed: false as const };
  const day = query.date ?? (await lastClosedDay());
  let people: string[];
  let scope: "mine" | "desk" | "group";
  if (v.staff) {
    const r = await loadRoster(req, query.scope);
    people = [...new Set([v.name, ...r.traders])];
    scope = r.scope;
  } else {
    people = await ownGroup(v.name);
    scope = "group";
  }
  const [d, notes] = await Promise.all([easyMoneyFor(day, people), notesOf(v.name, day)]);
  return {
    allowed: true as const, staff: v.staff, scope, day, people: people.length, checked: d.checked, noData: d.noData, notes, cfg: easyCfg(),
    moves: d.moves.map((m) => ({ ...m, rows: redactOthersMoney(m.rows, v.name, v.staff, { fields: ["net"] }) })),
  };
}));

router.put("/easy-money/note", route({
  body: z.object({ date: YMD, ticker: z.string().trim().max(12), note: z.string().max(NOTE_MAX * 2) }),
}, async ({ req, body }) => {
  const v = await boardViewer(req);
  if (!v) throw forbidden("trades.read.team");
  const ticker = normTicker(body.ticker);
  if (!ticker) throw new AppError("INVALID_TICKER");
  if (body.date > nyDate()) throw new AppError("DAY_IN_FUTURE");
  return saveNote(v.name, body.date, ticker, body.note);
}));

export default router;
