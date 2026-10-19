/** Props contracts of the game screen (components/sim/game-screen.tsx): the controller and the ticket owned by the page. */
import type { Speed } from "./model";
import type { TicketKind } from "./use-sim-game";

export type GameControls = {
  playing: boolean;
  setPlaying: (v: boolean) => void;
  busy: boolean;
  starting: boolean;
  next: (n?: number) => void;
  /** Jump to the next market event (step `until: "event"`); absent on controllers without it. */
  nextEvent?: () => void;
  order: (k: TicketKind) => void;
  breakEven: () => void;
  setBracket: (stop: number | null, target: number | null) => void;
  undo: () => void;
  finish: () => void;
  again: () => void;
  leave: () => void;
};

/** Ticket settings owned by the page (they feed the order requests). */
export type Ticket = {
  qty: number; setQty: (q: number) => void;
  /** Legacy autoplay speed of the controller (own-mode lead-in); the screen's playback has its own 1× / 5× / 30×. */
  speed?: Speed; setSpeed?: (s: Speed) => void;
  autoStop: boolean; setAutoStop: (v: boolean) => void;
  autoTarget: boolean; setAutoTarget: (v: boolean) => void;
  riskSize: boolean; setRiskSize: (v: boolean) => void;
  planStop: number | null; setPlanStop: (v: number | null) => void;
};
