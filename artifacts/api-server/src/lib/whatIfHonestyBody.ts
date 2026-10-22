/**
 * The body of GET /whatif/suggestions once the route knows the trader, the trades and the cache row — pure, so the
 * contract is tested without a database or a login (routes/__tests__/whatifHonestyBody.test.ts).
 *
 *  - team scope: the fast cards, `honesty.state = "team"` (the honest path runs per trader only);
 *  - a period that can never resolve a verdict (honestWindow: a rolling 30 / 90-day window, or a closed from–to range
 *    such as the weekly review's 8 weeks — it never grows to the 6 months the walk-forward needs, so «Подтверждено»
 *    and «нужно ещё ~N дней» could never come true there): the fast cards as in team scope, `honesty.state = "window"`,
 *    and the page offers «всё время» instead; nothing is queued;
 *  - a ready honest verdict: its cards («Подтверждено» / «Гипотеза»), every legacy field kept — `robust` is true only
 *    for a confirmed card, `holdout` is null, `sameData` = picked with no walk-forward. On «с начала года» a card
 *    whose days needed outrun the year (the window restarts on Jan 1) says «проверка — на всём периоде» instead;
 *  - otherwise: the fast cards marked «предварительно», and the state of the honest run (queued / running / failed, or
 *    unavailable when the job or the table is missing); the web polls every `pollMs` while it is queued or running,
 *    every 30 s once it has been pending for 3 min (`pendingMs`: the page says it is taking longer, and keeps polling).
 * Every card carries its timing («до входа» / «в сделке» / «разбор»).
 */
import type { Lang } from "../i18n";
import { describeRule } from "./whatIf";
import { type HonestCard, type HonestyResult, HONESTY } from "./whatIfHonesty";
import type { HonestyKey, HonestyState } from "./whatIfHonestyStore";
import type { Suggestion } from "./whatIfSuggest";

export type HonestyWireState = HonestyState | "team" | "unavailable" | "window";
export type CardStatus = "confirmed" | "hypothesis" | "preliminary";

export interface HonestyInfo {
  state: HonestyWireState;
  version: number;
  /** When the verdict was computed (ready only). */
  computedAt: string | null;
  wfAvailable: boolean | null;
  months: number | null;
  testDays: number | null;
  /** Cards by status (ready), else 0. */
  confirmed: number;
  hypotheses: number;
  /** Poll interval while the honest run is queued or running, else null. */
  pollMs: number | null;
  /** How long the honest run has been queued or running (since this key was requested), else null. */
  pendingMs: number | null;
}

/** A card on the wire: every field of the fast path, plus the honest ones (optional: older clients ignore them). */
export type WireSuggestion = Suggestion & {
  status?: CardStatus;
  oos?: HonestCard["oos"];
  needDays?: number | null;
  needDaysAtLeast?: boolean;
  /** The days needed outrun what this period can still gather («с начала года» near the year's end): check on «всё время». */
  needAllTime?: boolean;
  fragile?: HonestCard["fragile"];
};

export interface SuggestionsHead {
  scope: string | null;
  period: unknown;
  baselineNet: number;
  trades: number;
  days: number;
  smallSample: boolean;
  generatedAt: string;
}

export type SuggestionsBody = SuggestionsHead & { suggestions: WireSuggestion[]; tested: number; honesty?: HonestyInfo };

export const HONESTY_POLL_MS = 4000;
/** Pending longer than this: the web says the check is taking longer, and polls every HONESTY_BACKOFF_MS. */
export const HONESTY_SLOW_MS = 3 * 60_000;
export const HONESTY_BACKOFF_MS = 30_000;

/** Trading days (weekdays) after `today` up to Dec 31 of its year. */
function weekdaysLeftInYear(today: string): number {
  const end = Date.UTC(Number(today.slice(0, 4)), 11, 31);
  let n = 0;
  for (let t = Date.parse(`${today}T00:00:00Z`) + 86_400_000; t <= end; t += 86_400_000) {
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

/**
 * Can this period ever resolve an honest verdict? Only a window that keeps growing: «всё время» (no from, no to) or a
 * fixed start on Jan 1 with an open end («с начала года»; a past year's Jan 1 grows without limit). A rolling window
 * (the page's 30 / 90 days, `rolling`) or a closed from–to range never reaches more days, so it gets the fast path.
 * `reachDays` = trading days the window can still gather (null = unbounded): «с начала года» restarts on Jan 1.
 */
export function honestWindow(from: string | undefined, to: string | undefined, rolling: boolean, today: string): { honest: true; reachDays: number | null } | { honest: false } {
  if (to || rolling) return { honest: false };
  if (!from) return { honest: true, reachDays: null };
  if (!/^\d{4}-01-01$/.test(from)) return { honest: false };
  return { honest: true, reachDays: from.slice(0, 4) === today.slice(0, 4) ? weekdaysLeftInYear(today) : null };
}

/** The cache key of a trader's request (the trader comes from scopeTrader, never from the query as is). */
export function honestyKey(trader: string, from: string | undefined, to: string | undefined, sig: string): HonestyKey {
  return { trader, from: from ?? "", to: to ?? "", sig, version: HONESTY.version };
}

/** A stored honest card as a suggestion (labels rendered in the request language; days capped by what the period can reach). */
export function honestSuggestion(c: HonestCard, lang: Lang, reachDays: number | null = null): WireSuggestion {
  const outrun = c.needDays != null && reachDays != null && c.needDays > reachDays;
  return {
    rule: c.rule, label: describeRule(c.rule, lang), improvement: c.improvement, ci: c.ci,
    tradesLeft: c.tradesLeft, excluded: c.excluded,
    scenarioNet: c.scenarioNet, scenarioWinRate: c.scenarioWinRate, scenarioProfitFactor: c.scenarioProfitFactor,
    robust: c.status === "confirmed", removedNet: c.removedNet,
    kind: c.kind, picked: c.picked, sameData: c.sameData, holdout: null,
    affected: c.affected, changed: c.changed, estimate: c.estimate,
    timing: c.timing, status: c.status, oos: c.oos, fragile: c.fragile,
    needDays: outrun ? null : c.needDays, needDaysAtLeast: outrun ? false : c.needDaysAtLeast, ...(outrun ? { needAllTime: true } : {}),
  };
}

const info = (state: HonestyWireState, r?: { result: HonestyResult; finishedAt: Date | null }, pendingMs: number | null = null): HonestyInfo => {
  const pending = state === "queued" || state === "running";
  const ms = pending ? Math.max(0, pendingMs ?? 0) : null;
  return {
    state, version: HONESTY.version,
    computedAt: r?.finishedAt ? r.finishedAt.toISOString() : null,
    wfAvailable: r ? r.result.wfAvailable : null, months: r ? r.result.months : null, testDays: r ? r.result.testDays : null,
    confirmed: r ? r.result.confirmed : 0, hypotheses: r ? r.result.hypotheses : 0,
    pollMs: ms == null ? null : ms >= HONESTY_SLOW_MS ? HONESTY_BACKOFF_MS : HONESTY_POLL_MS,
    pendingMs: ms,
  };
};

export function suggestionsBody(x: {
  head: SuggestionsHead;
  lang: Lang;
  /** Team scope: the fast path only. */
  team: boolean;
  /** A period that can never resolve a verdict (honestWindow): the fast path only. */
  window?: boolean;
  /** Trading days the period can still gather (honestWindow; null = unbounded). */
  reachDays?: number | null;
  /** The fast search (team, window, or the «предварительно» fallback); null only when a ready verdict is served. */
  fast: { suggestions: Suggestion[]; tested: number } | null;
  /** The cache row of this trader's key (null: none, or the store is unreachable). */
  row: { state: HonestyState; result: HonestyResult | null; finishedAt: Date | null; requestedAt?: Date | null } | null;
  /** The job is registered and enabled and the table is reachable. */
  available: boolean;
  /** The request time (pendingMs). */
  now?: Date;
}): SuggestionsBody {
  if (!x.team && !x.window && x.row?.state === "ready" && x.row.result) {
    const result = x.row.result;
    return {
      ...x.head, suggestions: result.cards.map((c) => honestSuggestion(c, x.lang, x.reachDays ?? null)), tested: result.tested,
      honesty: info("ready", { result, finishedAt: x.row.finishedAt }),
    };
  }
  const fast = x.fast ?? { suggestions: [], tested: 0 };
  if (x.team || x.window) {
    return { ...x.head, suggestions: fast.suggestions, tested: fast.tested, honesty: info(x.team ? "team" : "window") };
  }
  const state: HonestyWireState = !x.available ? "unavailable" : x.row?.state ?? "queued";
  const since = x.row?.requestedAt;
  return {
    ...x.head,
    suggestions: fast.suggestions.map((s) => ({ ...s, status: "preliminary" as const })),
    tested: fast.tested,
    honesty: info(state, undefined, since && x.now ? x.now.getTime() - since.getTime() : 0),
  };
}
