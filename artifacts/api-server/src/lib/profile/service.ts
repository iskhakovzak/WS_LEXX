/**
 * Profile service — composes one person's profile: hero facts, the scored attributes against the desk median, the
 * biography, analytics, edge map, style and (staff only) the closest peer and curator steps. Read-only.
 *
 * The desk side (every active member's window trades → attributes, styles, trades/day, edge prior) is computed once per
 * DESK_TTL_MS and shared by every profile request (in-process cache, keyed by the NY day).
 */
import { deskPrior, Z80 } from "../stats";
import { nyDate, addDays } from "../tradingDate";
import { loadStageInfo } from "../people/stage";
import { edgeMapView, type EdgeMapView } from "../edgeMapStore";
import {
  WINDOW_DAYS, daysOf, deskMedians, deskTradesPerDay, scoreAttributes, summaryOf, withDeskMedians,
} from "./attributes";
import { cleanStreakOf, closestPeer, equityOf, keyStatsOf, recentDays, slicesBy, styleOf, windowOf, type KeyStats, type SliceSet, type Style } from "./analytics";
import { buildTimeline, erasOf } from "./timeline";
import {
  activeRules, careerTrades, curatorSteps, deskWindowTrades, firstTrade, history, idsOf, riskLimits, violations, type PersonRow,
} from "./load";
import { LINES } from "../quests/achievements";
import type { AttrKey, Attribute, Era, ProfileSummary, ProfileTrade, RiskLimits, TimelineEvent } from "./types";

export const DESK_TTL_MS = 10 * 60_000;

const CATEGORY = new Map<string, string>(LINES.map((l) => [l.id, l.category]));

/** What the viewer may see beyond the basics (decided by the route from capabilities). */
export type ProfileViewer = {
  self: boolean;
  /** Curator steps in the biography (journal.review on the person). */
  curatorSteps: boolean;
  /** Names the viewer may read (team.read scope): null = whole desk, [] / false = no peer. */
  peerScope: readonly string[] | null | false;
};

export type ProfileResponse = {
  person: {
    id: number; name: string; nameLatin: string | null; role: string; stage: string | null; stageSince: string | null;
    curator: string | null; mentor: string | null; joinedAt: string | null; firstTradeDay: string | null; lastTradeDay: string | null;
    accounts: string[]; self: boolean;
  };
  window: { from: string; to: string; days: number };
  streak: { current: number; best: number };
  achievements: { line: string; tier: string; day: string; category: string }[];
  summary: ProfileSummary;
  attributes: Attribute[];
  stats: KeyStats;
  equity: { day: string; net: number; cum: number }[];
  calendar: { day: string; net: number; trades: number }[];
  slices: { setups: SliceSet; tickers: SliceSet; windows: SliceSet };
  edge: EdgeMapView | null;
  style: Style;
  timeline: { eras: Era[]; events: TimelineEvent[] };
  peer: { id: number | null; name: string; similarity: number } | null;
  quotes: { favs: string[]; theme: string };
  generatedAt: string;
};

type Desk = {
  at: number;
  today: string;
  from: string;
  trades: Map<string, ProfileTrade[]>;
  violations: Map<string, number>;
  rules: Map<string, number>;
  limits: Map<string, RiskLimits>;
  tpd: number | null;
  medians: Record<AttrKey, number | null>;
  prior: { mu: number; tau: number } | null;
  styles: Map<string, Style>;
};

let deskCache: Desk | null = null;
let deskInflight: Promise<Desk> | null = null;

export function forgetProfileDesk(): void {
  deskCache = null;
}

async function computeDesk(today: string): Promise<Desk> {
  const from = addDays(today, -WINDOW_DAYS + 1);
  const [trades, viol, rules, limits] = await Promise.all([deskWindowTrades(from), violations(from, ""), activeRules(), riskLimits()]);
  const tpd = deskTradesPerDay([...trades.values()]);
  const attrs: Attribute[][] = [];
  const units: { xbar: number; se: number; n: number }[] = [];
  const styles = new Map<string, Style>();
  for (const [name, list] of trades) {
    const a = scoreAttributes({
      trades: list, violations: viol.counts.get(name) ?? 0, rulesActive: rules.get(name) ?? 0, limits: limits.get(name) ?? null,
      deskTradesPerDay: tpd, edgePrior: null, seed: name,
    });
    attrs.push(a);
    styles.set(name, styleOf(list));
    const e = a.find((x) => x.key === "edge");
    const lo = e?.inputs.lo80;
    const hi = e?.inputs.hi80;
    if (e && e.inputs.expectancy != null && lo != null && hi != null) units.push({ xbar: e.inputs.expectancy, se: Math.max(1e-6, (hi - lo) / (2 * Z80)), n: e.sample });
  }
  const p = deskPrior(units, { minN: 30, minUnits: 5, fallbackMu: 0, fallbackTau: 1 });
  return {
    at: Date.now(), today, from, trades, violations: viol.counts, rules, limits, tpd, medians: deskMedians(attrs),
    prior: p.method === "moments" ? { mu: p.mu, tau: p.tau } : null, styles,
  };
}

async function desk(today: string): Promise<Desk> {
  if (deskCache && deskCache.today === today && Date.now() - deskCache.at < DESK_TTL_MS) return deskCache;
  if (!deskInflight) {
    deskInflight = computeDesk(today)
      .then((d) => { deskCache = d; return d; })
      .finally(() => { deskInflight = null; });
  }
  return deskInflight;
}

/** The quote theme matching the weakest trait (or the strongest when nothing is weak): a tag of the quote library. */
export const QUOTE_THEME: Readonly<Record<AttrKey, string>> = {
  discipline: "discipline", risk: "risk", stability: "moderation", edge: "strategy",
  patience: "patience", execution: "focus", recovery: "resilience", growth: "learning",
};

export async function buildProfile(p: PersonRow, viewer: ProfileViewer, now = new Date()): Promise<ProfileResponse> {
  const today = nyDate(now);
  const [d, career, first, hist, stageMap, edge, steps, viol] = await Promise.all([
    desk(today),
    careerTrades(p.name),
    firstTrade(p.name),
    history(p.name),
    loadStageInfo([p.name]),
    edgeMapView(p.name).catch(() => null),
    viewer.curatorSteps ? curatorSteps(p.name) : Promise.resolve([]),
    violations(addDays(today, -WINDOW_DAYS + 1), p.name),
  ]);
  const windowTrades = career.filter((t) => t.day >= d.from);
  const attrs = withDeskMedians(scoreAttributes({
    trades: windowTrades, violations: viol.counts.get(p.name) ?? 0, rulesActive: d.rules.get(p.name) ?? 0,
    limits: d.limits.get(p.name) ?? null, deskTradesPerDay: d.tpd, edgePrior: d.prior, seed: p.name,
  }), d.medians);
  const days = daysOf(career);
  const summary = summaryOf(attrs, windowTrades.length ? windowTrades : career);
  const style = styleOf(windowTrades.length >= 20 ? windowTrades : career);

  let peer: ProfileResponse["peer"] = null;
  if (viewer.peerScope !== false) {
    const scope = viewer.peerScope === null ? null : new Set(viewer.peerScope);
    const others = [...d.styles.entries()].filter(([n]) => n !== p.name && (!scope || scope.has(n))).map(([name, s]) => ({ name, style: s }));
    const near = closestPeer(style, others);
    if (near) peer = { ...near, id: (await idsOf([near.name])).get(near.name) ?? null };
  }

  const stage = stageMap.get(p.name) ?? null;
  const trusted = attrs.filter((a) => !a.low && a.score !== null).sort((a, b) => a.score! - b.score!);
  const themeKey: AttrKey = summary.weak ?? summary.top[0] ?? trusted[0]?.key ?? "discipline";
  const best = new Map<string, { line: string; tier: string; day: string }>();
  const rank: Record<string, number> = { bronze: 0, silver: 1, gold: 2, platinum: 3 };
  for (const a of hist.achievements) {
    // Per-setup / per-leak / per-step lines live on the achievements shelf; the hero shows one coin per static line.
    if (a.line.includes(":")) continue;
    const cur = best.get(a.line);
    if (!cur || (rank[a.tier] ?? 0) >= (rank[cur.tier] ?? 0)) best.set(a.line, a);
  }

  return {
    person: {
      id: p.id, name: p.name, nameLatin: p.nameLatin, role: p.role, stage: stage?.stage ?? null, stageSince: stage?.since ?? null,
      curator: p.curator, mentor: p.mentor, joinedAt: p.joinedAt, firstTradeDay: days[0]?.day ?? null,
      lastTradeDay: days[days.length - 1]?.day ?? null, accounts: hist.accounts, self: viewer.self,
    },
    window: { from: d.from, to: today, days: WINDOW_DAYS },
    streak: cleanStreakOf(days.map((x) => x.day), viol.subjectDays),
    achievements: [...best.values()].map((a) => ({ ...a, category: CATEGORY.get(a.line) ?? "discipline" })).sort((a, b) => (rank[b.tier] ?? 0) - (rank[a.tier] ?? 0) || (a.day < b.day ? 1 : -1)),
    summary,
    attributes: attrs,
    stats: keyStatsOf(career, days),
    equity: equityOf(days),
    calendar: recentDays(days, today),
    slices: {
      setups: slicesBy(career, (t) => t.setup),
      tickers: slicesBy(career, (t) => t.ticker || null),
      windows: slicesBy(career, (t) => windowOf(t.entrySec), 5),
    },
    edge: edge && (edge.earn.length || edge.lose.length) ? edge : null,
    style,
    timeline: {
      eras: erasOf(days),
      events: buildTimeline({
        joinedAt: p.joinedAt, days, firstTrade: first, stages: hist.stages, readiness: hist.readiness,
        achievements: hist.achievements, rules: hist.rules, interventions: steps,
      }),
    },
    peer,
    quotes: { favs: viewer.self || viewer.curatorSteps ? p.quoteFavs.slice(0, 3) : [], theme: QUOTE_THEME[themeKey] },
    generatedAt: now.toISOString(),
  };
}
