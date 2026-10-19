/**
 * The chart overlay of the game screen and the chart's line interactions: fills / position / reveal markers, the
 * position box (or the flat plan's box) with «Стоп 9.40 · −$120 · 1R» labels, the missed move of a «Не торгую»
 * verdict, plus what dragging a line, Shift / Alt+click and the long-press menu do (move the order, or the plan while
 * flat). Numbers come from position-box.ts; this only wires them to the game state and the texts.
 */
import * as React from "react";
import { toast } from "@/hooks/use-toast";
import { fmtCount, fmtPrice, fmtUsd } from "@/lib/format";
import { simI18n } from "@/i18n/ns/simulator";
import { simOwnI18n } from "@/i18n/ns/simOwn";
import { maxQtyFor, riskQty, roundPrice } from "./model";
import { EMPTY_OVERLAY, type DragLine, type OverlayData, type OverlayDeskFill } from "./sim-overlay";
import { lineStat, placeInPosition, planBox, positionBox, rShort } from "./position-box";
import type { GameView } from "./use-sim-game";
import type { GameControls, Ticket } from "./game-types";

export function useGameOverlay({ game, c, k, planTarget, setPlanTarget, hiddenDesk }: {
  game: GameView;
  c: GameControls;
  k: Ticket;
  planTarget: number | null;
  setPlanTarget: (v: number | null) => void;
  hiddenDesk: ReadonlySet<string>;
}) {
  const { t } = simI18n.useT();
  const meta = game.meta;
  const s = game.state;
  const price = game.feed.bars[game.cursor]?.c ?? 0;
  const planStop = k.planStop;
  const open = s.trades.find((x) => x.closeIdx == null) ?? null;
  // 1R on the box = the distance to the stop while it is on the loss side (TradingView's risk / reward), else the
  // trade's own risk per share.
  const unit = s.pos !== 0 && s.avg != null && s.stop != null && (s.avg - s.stop) * Math.sign(s.pos) > 0
    ? Math.abs(s.avg - s.stop)
    : open && open.riskPerShare > 0 ? open.riskPerShare : meta.riskUnit;
  const oneR = meta.oneR ?? null;
  const planQty = k.riskSize && oneR != null
    ? riskQty(oneR, price, planStop ?? roundPrice(price - meta.riskUnit), maxQtyFor(meta.maxNotional, price)) ?? k.qty
    : k.qty;
  const lineText = React.useCallback((kind: "stop" | "target", p: number, st: { usd: number; r: number }) =>
    t(kind === "stop" ? "box.stop" : "box.target", { price: fmtPrice(p), usd: fmtUsd(st.usd, { signed: true, decimals: 0 }), r: rShort(st.r) }), [t]);

  const overlay: OverlayData = React.useMemo(() => {
    const sideWord = s.pos > 0 ? t("chart.long") : t("chart.short");
    const desk: OverlayDeskFill[] = [];
    const spans: OverlayData["spans"][number][] = [];
    if (game.reveal) {
      for (const d of game.reveal.desk.traders) {
        if (hiddenDesk.has(d.key)) continue;
        for (const tr of d.trades) for (const f of tr.fills) desk.push({ ...f, long: tr.side === "long", own: d.own, tag: d.own ? "" : d.label });
      }
      const marked = new Set<number>();
      for (const m of game.reveal.result.mistakes) {
        if (m.trade == null || marked.has(m.trade)) continue;
        const tr = s.trades.find((x) => x.n === m.trade);
        if (!tr) continue;
        marked.add(m.trade);
        spans.push({ from: tr.openIdx, to: tr.closeIdx ?? game.cursor, text: `${t("chart.mistake", { n: tr.n })} · ${t(`result.mistakeShort.${m.kind}`)}` });
      }
    }
    const own = meta.own;
    const marker = own && game.cursor >= own.decisionIdx ? { idx: own.decisionIdx, text: simOwnI18n.t("chartEntry") } : null;
    const missed = game.done ? meta.noTrade?.missed ?? null : null;
    const move = missed
      ? { from: missed.fromIdx, to: missed.toIdx, entry: missed.entry, extreme: missed.extreme, text: t("box.missed", { r: rShort(missed.r), side: missed.side === "long" ? t("chart.long") : t("chart.short") }) }
      : null;
    const flatPlan = !game.done && s.pos === 0;
    const pbx = flatPlan ? planBox({ price, stop: planStop, target: planTarget, qty: planQty, riskUnit: meta.riskUnit }) : null;
    const plan = flatPlan && planStop != null && pbx?.stop ? { price: planStop, text: lineText("stop", planStop, pbx.stop) } : null;
    const planT = flatPlan && planTarget != null && pbx?.target ? { price: planTarget, text: lineText("target", planTarget, pbx.target) } : null;
    if (!s.fills.length && !desk.length && s.pos === 0 && !spans.length) return { ...EMPTY_OVERLAY, cursor: game.cursor, marker, plan, planTarget: planT, last: price, move };
    const box = positionBox({ pos: s.pos, avg: s.avg, stop: s.stop, target: s.target, unit });
    return {
      marker, plan, planTarget: planT, last: price, move,
      fills: s.fills, pos: s.pos, avg: s.avg, stop: s.stop, target: s.target, openIdx: open?.openIdx ?? null, cursor: game.cursor, spans, desk,
      text: {
        position: s.pos !== 0 && s.avg != null ? t("chart.you", { side: sideWord, qty: fmtCount(Math.abs(s.pos)), price: fmtPrice(s.avg) }) : null,
        stop: s.stop != null && box?.stop ? lineText("stop", s.stop, box.stop) : null,
        target: s.target != null && box?.target ? lineText("target", s.target, box.target) : null,
      },
    };
  }, [s, game.cursor, game.reveal, game.done, meta.own, meta.noTrade, meta.riskUnit, hiddenDesk, planStop, planTarget, planQty, price, unit, open, lineText, t]);

  const live = React.useRef({ game, c, k, price, planTarget, planQty, unit });
  live.current = { game, c, k, price, planTarget, planQty, unit };

  /** Dragging a line on the chart = moving that order (or the plan while flat). */
  const onDragLine = React.useCallback((kind: DragLine, p: number) => {
    const st = live.current;
    const gs = st.game.state;
    if (kind === "plan") st.k.setPlanStop(p);
    else if (kind === "planTarget") setPlanTarget(p);
    else if (kind === "stop") st.c.setBracket(p, gs.target);
    else st.c.setBracket(gs.stop, p);
  }, [setPlanTarget]);

  /** Live label of a line while it is dragged. */
  const dragLabel = React.useCallback((kind: DragLine, p: number) => {
    const st = live.current;
    const gs = st.game.state;
    if (kind === "stop" || kind === "target") {
      if (gs.pos === 0 || gs.avg == null) return t(kind === "stop" ? "chart.stop" : "chart.target", { price: fmtPrice(p) });
      return lineText(kind, p, lineStat(gs.pos > 0 ? 1 : -1, gs.pos, gs.avg, p, st.unit));
    }
    const b = planBox({
      price: st.price, stop: kind === "plan" ? p : st.k.planStop, target: kind === "planTarget" ? p : st.planTarget, qty: st.planQty, riskUnit: st.game.meta.riskUnit,
    });
    const ls = kind === "plan" ? b?.stop : b?.target;
    return ls ? lineText(kind === "plan" ? "stop" : "target", p, ls) : fmtPrice(p);
  }, [t, lineText]);

  /** Shift / Alt+click or the menu: a stop / target at that price (a plan line while flat). */
  const place = React.useCallback((kind: "stop" | "target", p: number) => {
    const st = live.current;
    if (st.game.done) return;
    const gs = st.game.state;
    if (gs.pos === 0) {
      if (kind === "stop") st.k.setPlanStop(roundPrice(p)); else setPlanTarget(roundPrice(p));
      return;
    }
    const b = placeInPosition(kind, p, gs.pos, st.price, { stop: gs.stop, target: gs.target });
    if (b) st.c.setBracket(b.stop, b.target);
    else toast({ title: t("box.wrongSide") });
  }, [t, setPlanTarget]);

  return { overlay, onDragLine, dragLabel, place, planQty };
}
