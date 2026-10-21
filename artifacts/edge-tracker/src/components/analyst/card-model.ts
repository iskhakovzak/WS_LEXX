/**
 * Analyst feed on a phone (Волна 2 п. 2.11) — pure view model, unit-tested in __tests__/card-model.test.ts. The feed can
 * hold thousands of rows (the desktop table is virtualized); the phone list shows them in pages of CARD_PAGE with
 * «Показать ещё», so the DOM stays small without a fixed-height scroller.
 */
import type { Row } from "./rows";
import { gapOf } from "./lib";

export const CARD_PAGE = 40;

/** The first `limit` rows and how many are left (pure). */
export function cardPage<T>(rows: readonly T[], limit: number): { shown: readonly T[]; rest: number } {
  const n = Math.max(0, Math.min(rows.length, Math.floor(limit)));
  return { shown: rows.slice(0, n), rest: rows.length - n };
}

/** The next page size: CARD_PAGE or what is left. */
export const nextPageCount = (rest: number): number => Math.min(CARD_PAGE, Math.max(0, rest));

/** A row's reaction-day signal for the card: gap and RVOL of the current quote, RVOL highlighted from 2× (as the table). */
export function cardSignal(r: Pick<Row, "quote">): { gap: number | null; rvol: number | null; rvolStrong: boolean } {
  const raw = r.quote?.relativeVolume;
  const rvol = raw != null && Number.isFinite(raw) ? raw : null;
  return { gap: gapOf(r.quote), rvol, rvolStrong: rvol != null && rvol >= 2 };
}
