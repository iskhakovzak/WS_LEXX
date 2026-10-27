/**
 * Test-only frozen copy of the committed suggestionGrid (fe0de523), before the grid became a thin wrapper over
 * lib/whatIfRecipes: the parity tests compare the wrapper's output with this, rule for rule and in order.
 */
import type { ErrorVocabCode } from "../tradingErrors";
import { GRID_MISTAKES, type GridCandidate, nice, traderDayResults, trainDays, worstSetups } from "../whatIfGrid";
import { MAX_TAG_LEN, type Rule, type SimTrade, gradeRank, netOf, quantileSorted, traderDayKey } from "../whatIfTypes";

/** Trades carrying a mark: count, net, non-losing trades and trader-days (for the gates below). */
type Agg = { n: number; net: number; nonLosing: number; days: Set<string> };
const agg = (): Agg => ({ n: 0, net: 0, nonLosing: 0, days: new Set() });
function add(a: Agg, t: SimTrade, net: number): void {
  a.n++;
  a.net += net;
  if (net >= 0) a.nonLosing++;
  a.days.add(traderDayKey(t));
}
/** Labelling-bias gate: a mark only on losers makes the dollar delta circular — ≥ 2 and ≥ 15% must be non-losing. */
const labelOk = (a: Agg) => a.nonLosing >= 2 && a.nonLosing >= 0.15 * a.n;

/** ≥ 10 matching trades on ≥ 3 trader-days. */
function enough(trades: SimTrade[], match: (t: SimTrade) => boolean): boolean {
  let n = 0;
  const days = new Set<string>();
  for (const t of trades) if (match(t)) { n++; days.add(traderDayKey(t)); }
  return n >= 10 && days.size >= 3;
}

function niceSet(sorted: number[], qs: number[]): number[] {
  const out = new Set<number>();
  for (const q of qs) { const v = nice(quantileSorted(sorted, q)); if (v != null) out.add(v); }
  return [...out];
}

/**
 * The candidates for these trades. `team` = the whole desk (no share-size caps, no personal tags); `train` = TRAIN days
 * (default: trainDays of the trades; null = no holdout, picked families use the whole period).
 */
export function legacySuggestionGrid(input: SimTrade[], opts: { team?: boolean; train?: ReadonlySet<string> | null } = {}): GridCandidate[] {
  const team = opts.team === true;
  const trades = input.filter((t) => t.gross != null);
  const train = opts.train === undefined ? trainDays(trades) : opts.train;
  const inTrain = (t: SimTrade) => train == null || train.has(t.day);
  const out: GridCandidate[] = [];
  const ex = (rule: Rule, picked = false) => out.push({ rule, kind: "exante", picked });
  const lb = (rule: Rule, picked = false) => out.push({ rule, kind: "label", picked });

  const hasTime = trades.some((t) => t.entryMin != null);
  if (hasTime) {
    for (const to of ["10:30", "11:00", "11:30", "12:00", "13:00", "14:00", "15:00"]) ex({ type: "timeWindow", to });
    for (const from of ["09:35", "09:45", "10:00", "10:30"]) ex({ type: "timeWindow", from });
    // «Без премаркета» / «без входов после 16:00» only when there is enough of it.
    if (enough(trades, (t) => t.entryMin != null && t.entryMin < 570)) ex({ type: "timeWindow", from: "09:30" });
    if (enough(trades, (t) => t.entryMin != null && t.entryMin >= 960)) ex({ type: "timeWindow", to: "16:00" });
    ex({ type: "timeWindow", from: "09:30", to: "10:30" });
    ex({ type: "timeWindow", from: "10:00", to: "12:00" });
  }
  for (const min of [2, 5, 10, 20, 50]) ex({ type: "priceRange", min });
  for (const max of [20, 50, 100, 200]) ex({ type: "priceRange", max });
  for (const n of [2, 3, 5, 8, 10]) ex({ type: "maxTradesPerDay", n });
  for (const n of [1, 2, 3]) ex({ type: "stopAfterLosses", n });
  if (hasTime) for (const minutes of [2, 5, 10, 15, 30, 60]) ex({ type: "afterLoss", minutes });

  // Share-size caps relative to the trader's own sizes (one trader only: sizes of different traders do not compare).
  const sizes = team ? [] : trades.map((t) => t.qty).filter((q): q is number => q != null && q > 0).sort((a, b) => a - b);
  if (sizes.length >= 20) {
    const caps = new Set<number>();
    for (const q of [0.5, 0.75, 0.9]) {
      const v = quantileSorted(sizes, q);
      const capped = v < 100 ? Math.max(1, Math.round(v / 10) * 10) : Math.round(v / 50) * 50;
      if (capped > 0) caps.add(capped);
    }
    for (const max of caps) ex({ type: "sizeRange", max });
  }

  // Day limits from the trader-days (team scope: each trader's own day).
  const tdays = traderDayResults(trades);
  const losses = tdays.filter((d) => d.net < 0).map((d) => -d.net).sort((a, b) => a - b);
  if (losses.length >= 3) for (const usd of niceSet(losses, [0.5, 0.75, 0.9])) ex({ type: "dailyLossLimit", usd });
  ex({ type: "excludeSide", side: "long" });
  ex({ type: "excludeSide", side: "short" });

  const imx = trades.filter((t) => t.imx === true).length;
  if (imx >= 10 && trades.length - imx >= 30) ex({ type: "excludeImx" });
  if (trades.filter((t) => t.reentry === true).length >= 10) ex({ type: "noReentry" });
  const rels = trades.map((t) => t.sizeRel).filter((v): v is number => v != null && v > 0);
  if (rels.length >= 20) for (const x of [1.5, 2, 3]) if (rels.filter((v) => v > x).length >= 10) ex({ type: "maxSizeRel", x });

  const greens = tdays.filter((d) => d.net > 0).map((d) => d.net).sort((a, b) => a - b);
  if (greens.length >= 10) {
    const peak = nice(quantileSorted(greens, 0.5));
    if (peak != null) for (const pct of [30, 50]) ex({ type: "profitGiveback", peak, pct });
    for (const usd of niceSet(greens, [0.75, 0.9])) ex({ type: "dailyProfitTarget", usd });
  }

  // Worst tickers, picked on TRAIN.
  const byTicker = new Map<string, { net: number; n: number }>();
  for (const t of trades) {
    if (!inTrain(t)) continue;
    const e = byTicker.get(t.ticker) ?? { net: 0, n: 0 };
    e.net += netOf(t) as number; e.n++;
    byTicker.set(t.ticker, e);
  }
  const minPick = train ? 7 : 10;
  const worst = [...byTicker.entries()].filter(([, e]) => e.n >= minPick && e.net < 0).sort((a, b) => a[1].net - b[1].net || a[0].localeCompare(b[0])).slice(0, 3);
  for (const [ticker] of worst) ex({ type: "excludeTickers", tickers: [ticker] }, true);
  for (const setups of worstSetups(train ? trades.filter(inTrain) : trades, minPick)) lb({ type: "excludeSetups", setups }, true);

  // Entry-time mistakes the trader marked (whole period; the labelling-bias gate keeps it honest).
  const qualifying: ErrorVocabCode[] = [];
  for (const code of GRID_MISTAKES) {
    const a = agg();
    for (const t of trades) if (t.mistakes?.includes(code)) add(a, t, netOf(t) as number);
    if (a.n >= 8 && a.days.size >= 3 && a.net < 0 && labelOk(a)) qualifying.push(code);
  }
  for (const code of qualifying) lb({ type: "excludeMistakes", codes: [code] });
  if (qualifying.length >= 2) lb({ type: "excludeMistakes", codes: [...qualifying] });

  // Personal tags (one trader only: every trader uses their own words), picked on TRAIN.
  if (!team) {
    const by = new Map<string, { name: string; all: Agg; train: Agg }>();
    for (const t of trades) {
      if (!t.ptags?.length) continue;
      const net = netOf(t) as number;
      const seen = new Set<string>();
      for (const tag of t.ptags) {
        const k = tag.trim().toLowerCase();
        // A rule takes tags ≤ MAX_TAG_LEN (ruleSchema): a longer one would be a card the server refuses to run.
        if (!k || k.length > MAX_TAG_LEN || seen.has(k)) continue;
        seen.add(k);
        const e = by.get(k) ?? { name: tag.trim(), all: agg(), train: agg() };
        add(e.all, t, net);
        if (inTrain(t)) add(e.train, t, net);
        by.set(k, e);
      }
    }
    const pickNet = (e: { all: Agg; train: Agg }) => (train ? e.train.net : e.all.net);
    const ok = [...by.values()]
      .filter((e) => e.all.n >= 10 && e.all.days.size >= 3 && (!train || e.train.n >= 7) && pickNet(e) < 0 && labelOk(e.all))
      .sort((a, b) => pickNet(a) - pickNet(b) || a.name.localeCompare(b.name));
    if (ok[0]) lb({ type: "excludeTags", tags: [ok[0].name] }, true);
    if (ok[1]) lb({ type: "excludeTags", tags: [ok[0].name, ok[1].name] }, true);
  }

  // Own grades: only when most trades are graded (the rule drops ungraded trades).
  const graded = trades.filter((t) => gradeRank(t.grade) != null).length;
  if (graded >= 30 && graded >= 0.6 * trades.length) for (const grade of ["A", "B"] as const) lb({ type: "minGrade", grade });
  return out;
}
