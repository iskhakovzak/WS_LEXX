/**
 * Simulator execution realism (owner 2026-10-18: «симулятор конкретно улучшить» — spread + slippage, sizing by 1R).
 * Pure; the numbers come from the desk settings (group `trainer`) and are frozen into the game at creation
 * (sim_games.params.exec), so a later settings change never re-prices a game already played. Games created before
 * this model have no params.exec and keep filling at the bar's close / the stop price exactly.
 *
 *   spread      max(spreadCents, price × spreadBps) × lowPriceMult (price < lowPriceUsd) × lowAdvMult (day volume
 *               < lowAdvShares) — in $ per share;
 *   market      (buy / sell / flat / the auto close at the end) fills at the bar's close ± half the spread ± slip;
 *   stop        fills at the stop ∓ stopSlip; a bar that opens through the stop fills at its open ∓ stopSlip;
 *   target      a resting limit: fills at the target exactly (or at a better open on a gap).
 */
import { setting } from "../settings/registry";

export type ExecModel = {
  /** Half the quoted spread, $ per share. */
  halfSpread: number;
  /** Market-order slippage on top of the half spread, $ per share. */
  slip: number;
  /** Stop-order slippage, $ per share. */
  stopSlip: number;
};

export type ExecSettings = {
  spreadCents: number;
  spreadBps: number;
  lowPriceUsd: number;
  lowPriceMult: number;
  lowAdvShares: number;
  lowAdvMult: number;
  slipCents: number;
  stopSlipCents: number;
};

const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** Full spread in $ per share for a price and the day's volume (shares). */
export function spreadOf(price: number, volume: number | null, s: ExecSettings): number {
  if (!(price > 0)) return 0;
  let spread = Math.max(s.spreadCents / 100, (price * s.spreadBps) / 10_000);
  if (price < s.lowPriceUsd) spread *= s.lowPriceMult;
  if (volume != null && volume >= 0 && volume < s.lowAdvShares) spread *= s.lowAdvMult;
  return r4(spread);
}

export function execModelOf(price: number, volume: number | null, s: ExecSettings): ExecModel {
  return { halfSpread: r4(spreadOf(price, volume, s) / 2), slip: r4(s.slipCents / 100), stopSlip: r4(s.stopSlipCents / 100) };
}

/** Market fill price: `side` +1 buying, −1 selling. */
export function marketPx(close: number, side: 1 | -1, m: ExecModel | null | undefined): number {
  return m ? r4(close + side * (m.halfSpread + m.slip)) : close;
}

/** Stop fill price for a position of sign `pos` (a long's stop sells lower, a short's stop buys higher). */
export function stopPx(px: number, pos: number, m: ExecModel | null | undefined): number {
  return m ? r4(px - Math.sign(pos) * m.stopSlip) : px;
}

/**
 * Shares for a risk-sized order: 1R ($) / (|expected fill − stop|), rounded down; 0 when the stop is on the wrong
 * side or too close to size anything.
 */
export function riskQty(oneR: number, fillPx: number, stop: number, side: 1 | -1): number {
  const dist = Math.round((fillPx - stop) * side * 1e6) / 1e6; // prices are cents: drop float noise (0.5000000000007)
  if (!(oneR > 0) || !(dist > 0)) return 0;
  return Math.max(0, Math.floor(oneR / dist + 1e-9));
}

/** Public model info for the client (Snapshot.slippage). */
export function publicExec(m: ExecModel | null | undefined): { perShare: number; spread: number } | null {
  return m ? { perShare: r4(m.halfSpread + m.slip), spread: r4(m.halfSpread * 2) } : null;
}

/** Sum of a day's bar volumes (the low-ADV switch; a game's own day is the best proxy the archive has). */
export function dayVolume(bars: readonly { v: number }[]): number {
  let v = 0;
  for (const b of bars) v += Number.isFinite(b.v) ? b.v : 0;
  return v;
}

/** The desk settings in force (group `trainer`). */
export function execSettings(): ExecSettings {
  return {
    spreadCents: setting("trainer.spreadUsd") * 100,
    spreadBps: setting("trainer.spreadBps"),
    lowPriceUsd: setting("trainer.lowPriceUsd"),
    lowPriceMult: setting("trainer.lowPriceSpreadMult"),
    lowAdvShares: setting("trainer.lowAdvShares"),
    lowAdvMult: setting("trainer.lowAdvSpreadMult"),
    slipCents: setting("trainer.slipUsd") * 100,
    stopSlipCents: setting("trainer.stopSlipUsd") * 100,
  };
}

/** The model a NEW game freezes into params.exec (null when the desk switched the model off). */
export function newGameExec(price: number, volume: number | null): ExecModel | null {
  return setting("trainer.execEnabled") ? execModelOf(price, volume, execSettings()) : null;
}
