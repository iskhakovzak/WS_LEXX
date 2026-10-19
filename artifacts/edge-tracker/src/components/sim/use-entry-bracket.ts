/**
 * What happens around the player's orders without them asking: (1) when an entry fills, the automatic bracket — the
 * stop just beyond the nearest level (PDH / PDL / PDC / PMH / PML / today's high or low), else 1 risk unit, and the
 * target at 2R — and / or the planned target is sent (the order itself already carried a 1R stop, so the position is
 * never unprotected); (2) a stop / target fill pauses playback and says why.
 */
import * as React from "react";
import { simI18n } from "@/i18n/ns/simulator";
import type { Levels } from "./api";
import { roundPrice } from "./model";
import { autoBracket, type NamedLevel } from "./position-box";
import { dayHiLo } from "./tf-model";
import type { GameControls } from "./game-types";
import type { GameView } from "./use-sim-game";

/** Level keys → the short names traders use (the same on the chart). */
const LEVEL_LABEL: Record<string, string> = { pdh: "PDH", pdl: "PDL", pdc: "PDC", pmh: "PMH", pml: "PML", hod: "HOD", lod: "LOD" };

export function levelList(levels: Levels, game: GameView): NamedLevel[] {
  const hl = dayHiLo(game.feed.bars);
  return [
    { key: "pdh", price: levels.pdh }, { key: "pdl", price: levels.pdl }, { key: "pdc", price: levels.pdc }, { key: "pmh", price: levels.pmh }, { key: "pml", price: levels.pml },
    { key: "hod", price: hl?.hod }, { key: "lod", price: hl?.lod },
  ];
}

export function useEntryBracket({ game, c, levels, auto, riskSize, planStop, planTarget, setPlanTarget, pauseAll }: {
  game: GameView;
  c: GameControls;
  levels: Levels;
  auto: boolean;
  riskSize: boolean;
  planStop: number | null;
  planTarget: number | null;
  setPlanTarget: (v: number | null) => void;
  pauseAll: () => void;
}): { autoNote: string | null; notice: string | null; setNotice: (v: string | null) => void } {
  const { t } = simI18n.useT();
  const [autoNote, setAutoNote] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const { pos } = game.state;
  const done = game.done;
  const id = game.meta.id;
  React.useEffect(() => { setAutoNote(null); setNotice(null); }, [id]);

  // Entry filled → the automatic bracket and / or the planned target.
  const prevPos = React.useRef(pos);
  const ctx = React.useRef({ game, c, levels, auto, riskSize, planStop, planTarget });
  ctx.current = { game, c, levels, auto, riskSize, planStop, planTarget };
  React.useEffect(() => {
    const was = prevPos.current;
    prevPos.current = pos;
    if (done || pos === 0 || (was !== 0 && Math.sign(was) === Math.sign(pos))) return;
    const x = ctx.current;
    const s = x.game.state;
    const price = x.game.feed.bars[x.game.cursor]?.c ?? 0;
    const dir: 1 | -1 = pos > 0 ? 1 : -1;
    let stop = s.stop, target = s.target, note: string | null = null;
    const usedPlan = x.planStop != null && (x.planStop - price) * dir < 0;
    if (x.auto && !usedPlan && !x.riskSize) {
      const ab = autoBracket(dir, price, x.game.meta.riskUnit, levelList(x.levels, x.game));
      if (ab) { stop = ab.stop; target = ab.target; note = ab.level ? t("box.autoLevel", { level: LEVEL_LABEL[ab.level] ?? ab.level.toUpperCase() }) : null; }
    } else if (x.auto && usedPlan && stop != null) {
      target = roundPrice(price + dir * 2 * Math.abs(price - stop));
    }
    if (x.planTarget != null && (x.planTarget - price) * dir > 0) target = x.planTarget;
    if (stop !== s.stop || target !== s.target) x.c.setBracket(stop, target);
    setAutoNote(note);
    setPlanTarget(null);
  }, [pos, done, t, setPlanTarget]);

  // A stop / target fill pauses playback.
  const seen = React.useRef({ id, n: game.state.fills.length });
  React.useEffect(() => {
    const fills = game.state.fills;
    if (seen.current.id !== id) { seen.current = { id, n: fills.length }; return; }
    const fresh = fills.slice(seen.current.n);
    seen.current.n = fills.length;
    const hit = [...fresh].reverse().find((f) => f.reason === "stop" || f.reason === "target");
    if (!hit || done) return;
    pauseAll();
    setNotice(t(hit.reason === "stop" ? "play.pausedStop" : "play.pausedTarget"));
  }, [game.state.fills, id, done, pauseAll, t]);
  React.useEffect(() => {
    if (!notice) return;
    const h = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(h);
  }, [notice]);

  return { autoNote: pos !== 0 ? autoNote : null, notice, setNotice };
}
