/**
 * The dashboard by the trader's day state (lib/day-state, computed on the server) — pure. Each state picks what comes
 * first and folds what does not fit right now: folded tiles stay in the layout and come back with «Показать всё»
 * (nothing is deleted; the edit mode always shows the whole layout).
 *
 *   stopped        the stop card leads; the plan, regime, streak praise, check-in and extras fold; the mentor says the stop
 *   paused         «С возвращением» leads with one small step; the plan card (its old backlog), mentor, praise and extras fold
 *   newcomer       the path to the first trades leads; empty analytics folds with «появится после N сделок»
 *   premarket      plan section first (regime, plan; the check-in sits under it), then the brief and the market extras
 *   session        «Ваш edge» first («Где уходят деньги» right under the live day), then trades, then the plan
 *   after_session  the day's review (plan card) first, then «Где уходят деньги»
 * Staff on «Команда» see the default composition (the state is about one's own day).
 */
import type { TraderStateKey } from "@/lib/day-state";
import { BOARD_SECTIONS, type BoardSection } from "./layout-model";
import type { SectionId } from "./use-dashboard";

export type StateLayout = {
  state: TraderStateKey | null;
  order: readonly BoardSection[];
  fold: ReadonlySet<SectionId>;
  /** Tiles moved to the front of their own section, in this order. */
  first: readonly SectionId[];
  /** «Ваш edge» shows «появится после N сделок» instead of empty tiles. */
  edgeNote: boolean;
  /** The mentor tile states the stop instead of its rhythm line. */
  mentorStop: boolean;
  /** The hero's extra lines (wrapped, today's edge line) stay out — one card leads. */
  quietHero: boolean;
};

export const EDGE_TILES: readonly SectionId[] = ["leaks", "streaks", "seqDay", "afterLoss", "holdTime", "fees", "weekdays"];
const EXTRAS: readonly SectionId[] = ["checkin", "brief", "quote", "sectors", "macro", "dna", "psychology"];

const DEFAULT: StateLayout = {
  state: null, order: BOARD_SECTIONS, fold: new Set(), first: [], edgeNote: false, mentorStop: false, quietHero: false,
};

const fold = (...ids: (SectionId | readonly SectionId[])[]) => new Set<SectionId>(ids.flat());

export function stateLayout(state: TraderStateKey | null | undefined): StateLayout {
  switch (state) {
    case "stopped":
      return { ...DEFAULT, state, fold: fold("attention", "regime", "streaks", EXTRAS), first: ["mentor"], mentorStop: true, quietHero: true };
    case "paused":
      return { ...DEFAULT, state, fold: fold("attention", "mentor", "streaks", EXTRAS), first: ["leaks"], quietHero: true };
    case "newcomer":
      return { ...DEFAULT, state, order: ["plan", "trades", "edge", "extras"], fold: fold(EDGE_TILES, "quote", "sectors", "dna", "psychology"), edgeNote: true, quietHero: true };
    case "premarket":
      return { ...DEFAULT, state, order: ["plan", "extras", "edge", "trades"], fold: fold("quote", "dna", "psychology"), first: ["regime", "attention", "checkin", "brief", "macro"] };
    case "session":
      return { ...DEFAULT, state, order: ["edge", "trades", "plan", "extras"], fold: fold("checkin", "brief", "quote", "dna", "psychology"), first: ["leaks", "positions"] };
    case "after_session":
      return { ...DEFAULT, state, fold: fold("regime", "checkin", "brief", "quote", "dna"), first: ["attention", "leaks"] };
    default:
      return DEFAULT;
  }
}

/** A section's items with the state's `first` tiles moved to the front (stable for the rest). */
export function orderFirst<T extends { id: SectionId }>(items: readonly T[], first: readonly SectionId[]): T[] {
  if (!first.length) return [...items];
  const rank = (id: SectionId) => {
    const i = first.indexOf(id);
    return i < 0 ? first.length : i;
  };
  return items.map((it, i) => ({ it, i })).sort((a, b) => rank(a.it.id) - rank(b.it.id) || a.i - b.i).map((x) => x.it);
}
