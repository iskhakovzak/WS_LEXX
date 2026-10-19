/**
 * «Тренажёр 2» quick decisions on a game (owner 2026-10-19: fast reps — more good decisions per minute):
 *
 *   POST /api/sim/games/:id/skip       before any order → status 'skipped' (out of stats, leaderboards, quests and
 *                                      mastery: they all count 'finished' games only); after an order the game is
 *                                      finished as with /finish (counted — skipping never hides a trade).
 *                                      «Задача дня» and own replays cannot be skipped.
 *   POST /api/sim/games/:id/no-trade   flat with no order yet → a scored decision (noTrade.ts): the game is finished
 *                                      with 0 trades and result.noTrade = the verdict.
 */
import { conflict } from "../http";
import { simulate } from "./engine";
import { noTradeVerdict, windowEndOf, type NoTradeVerdict } from "./noTrade";
import { tfSec } from "./scenario";
import * as store from "./store";
import type { SeriesState } from "./seriesStore";
import { baseTfOf, cfgOf, finishNow, ownGame, seriesOfEnded, snapshotOf, withLock, type Snapshot, type Viewer } from "./service";

const hasOrders = (g: store.GameRow) => g.events.some((e) => e.type === "order");

export type SkipOutput = { outcome: "skipped" | "finished"; snapshot: Snapshot; series?: SeriesState };

export function skipGame(viewer: Viewer, id: number): Promise<SkipOutput> {
  return withLock(id, async () => {
    const g = await ownGame(viewer, id);
    if (g.status !== "active") throw conflict("CONFLICT", { reason: "finished" });
    if (g.params.daily || g.params.own) throw conflict("CONFLICT", { reason: "notSkippable" });
    let outcome: SkipOutput["outcome"];
    if (hasOrders(g)) {
      await finishNow(g);
      outcome = "finished";
    } else {
      await store.markSkipped(g.id, g.cursor);
      g.status = "skipped";
      g.finishedAt = new Date().toISOString();
      outcome = "skipped";
    }
    return { outcome, snapshot: await snapshotOf(g, viewer), ...(await seriesOfEnded(g)) };
  });
}

export type NoTradeOutput = { verdict: NoTradeVerdict; snapshot: Snapshot; series?: SeriesState };

export function noTrade(viewer: Viewer, id: number): Promise<NoTradeOutput> {
  return withLock(id, async () => {
    const g = await ownGame(viewer, id);
    if (g.status !== "active") throw conflict("CONFLICT", { reason: "finished" });
    if (hasOrders(g) || simulate(g.bars, cfgOf(g), g.events, g.cursor).pos !== 0) throw conflict("CONFLICT", { reason: "traded" });
    const end = windowEndOf(g.cursor, g.endIdx, tfSec(baseTfOf(g)), g.mode === "swing");
    const verdict = noTradeVerdict(g.bars, g.cursor, end, g.params.riskUnit);
    await finishNow(g, { noTrade: verdict });
    return { verdict, snapshot: await snapshotOf(g, viewer), ...(await seriesOfEnded(g)) };
  });
}
