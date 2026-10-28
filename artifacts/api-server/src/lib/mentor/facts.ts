/**
 * What the mentor knows about a trader, gathered from the journal (DB-backed, read-only): the stage, the
 * «характеристика» (profile attributes), the edge map's leaks and strengths in $ per day, the desk regime of today and
 * the trader's edge in it, playbook setups, 1:1 agreements, the daily focus, today's check-in, recent days and the
 * active commitments with their progress. Every source is optional: one that fails is logged and left out, so the
 * mentor still talks (and says what it lacks) instead of failing.
 *
 * `facts` is the list the trader sees in «Что ментор знает обо мне» (codes + params, rendered by the web; a fact the
 * trader hid is marked and never reaches the model). `model` is the compact JSON the model gets.
 */
import { pool } from "@workspace/db";
import { logger } from "../logger";
import { addDays } from "../tradingDate";
import { stageOf } from "../people/stage";
import { personByName } from "../profile/load";
import { buildProfile } from "../profile/service";
import { regimeDay, regimeTrades } from "../marketRegime/store";
import { regimeEdge } from "../marketRegime/edge";
import { playbookToday } from "../playbookToday/service";
import { focusFor, mistakesByTrade } from "../daily/service";
import { behaviorTradesOf } from "../daily/load";
import { riskStateOf, riskSummary, UNKNOWN_RISK, type RiskSummary } from "../coreMetrics/risk";
import type { DayRow } from "../riskMetrics";
import type { BehaviorTrade } from "../behaviorEngine";
import { commitmentVerdict, trackCommitment, type Progress, type Verdict } from "./commitments";
import { lastWeekdays, type TradedDay } from "./escalation";
import { listCommitments, listNotes, hiddenFacts, type Commitment, type Note } from "./store";
import { dayTwoOf, formulaBreaksOf } from "../catalyst/store";
import type { DayTwoHint, FormulaBreak } from "../catalyst/model";
import { normFormula, type StrategyFormula } from "../strategyFormula";
import { setting } from "../settings/registry";
import { dayFlowFactsOf, isEmptyDayFlow, type DayFlowFacts } from "../sessionFlow/stats";
import { seasonDay } from "../sessionFlow/seasonStore";
import type { SeasonDay } from "../sessionFlow/season";
import { openWindowStateOf } from "../sessionFlow/gates";
import type { OpenWindowState } from "../sessionFlow/openWindow";
import { deskPulseOf } from "../deskPulse/store";
import type { PulseHighlight } from "../deskPulse/pulse";
import { personalEasyMoney, type PersonalEasyMoney } from "../deskPulse/easyStore";

/** Calendar days of trades the formula check looks back over (≈ two trading weeks; the debrief names the latest). */
const FORMULA_LOOKBACK_DAYS = 14;

export type FactKind = "stage" | "strength" | "weakness" | "leak" | "edge" | "regime" | "agreement" | "focus";
/** One data fact: a stable key (hide / show), a kind and its params (numbers, codes, the agreement's own title). */
export type Fact = { key: string; kind: FactKind; params: Record<string, string | number | null>; hidden: boolean };

export type CommitmentView = Commitment & { progress: Progress; verdict: Verdict };

export type DayStat = { day: string; trades: number; net: number; wins: number; losses: number };

export type Checkin = { sleepWell: boolean; focused: boolean; stressed: boolean; anxious: boolean; tilted: boolean; revenge: boolean; note: string | null };

export type MentorFacts = {
  trader: string;
  today: string;
  stage: string | null;
  facts: Fact[];
  notes: Note[];
  commitments: { active: CommitmentView[]; closed: Commitment[] };
  checkin: Checkin | null;
  /** Traded days of the last ~30 calendar days (oldest first). */
  days: DayStat[];
  /** Tilt / revenge / martingale flags per traded day (escalation). */
  tiltDays: Set<string>;
  /**
   * The risk state from the SAME loader as the dashboard hero (lib/coreMetrics/risk → GET /risk/me): the stop, the
   * drawdown from the equity peak and the limits in effect. A stopped trader is told so, never «trade to −$X».
   */
  risk: RiskSummary;
  regime: string | null;
  playbook: { id: number; name: string; fitsRegime: boolean; picked: boolean; verdict: string | null; trades: number; winRate: number | null; formula?: StrategyFormula | null }[];
  focus: { mistake: string | null; costNet: number | null; count: number; own: string | null } | null;
  /** «Day two after a strong catalyst» (lib/catalyst): yesterday's strong catalysts that moved big — deterministic lines. */
  dayTwo: DayTwoHint[];
  /** Recent trades entered on a setup whose strategy formula needs a catalyst the plan mark does not show. */
  formulaBreaks: FormulaBreak[];
  /** Today's session flow from the fills (lib/sessionFlow): re-entries, chases, give-back from the peak, green-to-red. */
  flow: DayFlowFacts | null;
  /** Today's season calendar (lib/sessionFlow/season): quiet day + its limit factor, prime earnings week, events. */
  season: SeasonDay | null;
  /** The opening window 09:30–10:00 today (lib/sessionFlow/openWindow): its own loss limit, or lifted by a proven edge. */
  openWindow: OpenWindowState | null;
  /** «This season» on the desk (lib/deskPulse): the family × timing that works and the one that fails (desk aggregates). */
  pulse: { works: PulseHighlight | null; fails: PulseHighlight | null; from: string; to: string } | null;
  /** «Лёгкие деньги дня» of today (lib/deskPulse): the clean moves the trader took, traded against, skipped or missed. */
  easyMoney: PersonalEasyMoney | null;
};

const LOOKBACK_DAYS = 35;
const TILT_MISTAKES = new Set(["behavior:tilt", "behavior:revenge", "behavior:martingale"]);

async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logger.warn({ err, source: label }, "mentor: a fact source failed");
    return fallback;
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Per traded day: trades / wins / losses from the behaviour rows; the day's NET from the risk desk's day rows when there
 * are any (broker rows win over journal rows — the number the hero shows), else the sum of the behaviour rows.
 */
export function dayStats(trades: readonly BehaviorTrade[], dayNets: readonly Pick<DayRow, "date" | "pnl">[] = []): DayStat[] {
  const by = new Map<string, DayStat>();
  for (const t of trades) {
    if (!t.date) continue;
    const d = by.get(t.date) ?? { day: t.date, trades: 0, net: 0, wins: 0, losses: 0 };
    d.trades++;
    d.net = round2(d.net + (t.net ?? 0));
    if (t.result === "win") d.wins++;
    if (t.result === "loss") d.losses++;
    by.set(t.date, d);
  }
  const nets = new Map(dayNets.filter((d) => d.pnl != null).map((d) => [d.date, d.pnl as number]));
  for (const d of by.values()) { const n = nets.get(d.day); if (n != null) d.net = round2(n); }
  return [...by.values()].sort((a, b) => a.day.localeCompare(b.day));
}

async function agreements(trader: string): Promise<{ id: number; title: string; dueOn: string | null }[]> {
  const { rows } = await pool.query<{ id: number; title: string; due_on: string | null }>(
    `SELECT id, title, to_char(due_on, 'YYYY-MM-DD') AS due_on FROM academy_action_items
      WHERE student = $1 AND status = 'open' AND archived_at IS NULL ORDER BY due_on NULLS LAST, id LIMIT 5`,
    [trader],
  );
  return rows.map((r) => ({ id: Number(r.id), title: String(r.title).slice(0, 200), dueOn: r.due_on }));
}

async function checkinOf(trader: string, day: string): Promise<Checkin | null> {
  const { rows } = await pool.query<{ sleep_well: boolean; focused: boolean; stressed: boolean; anxious: boolean; tilted: boolean; revenge: boolean; free_text: string | null }>(
    `SELECT sleep_well, focused, stressed, anxious, tilted, revenge, free_text FROM emotional_state_log WHERE user_id = $1 AND date = $2 ORDER BY id DESC LIMIT 1`,
    [trader, day],
  );
  const r = rows[0];
  return r ? { sleepWell: r.sleep_well, focused: r.focused, stressed: r.stressed, anxious: r.anxious, tilted: r.tilted, revenge: r.revenge, note: r.free_text?.slice(0, 300) ?? null } : null;
}

async function profileFacts(trader: string): Promise<Fact[]> {
  const p = await personByName(trader);
  if (!p) return [];
  const prof = await buildProfile(p, { self: true, curatorSteps: false, peerScope: false });
  const score = (k: string) => prof.attributes.find((a) => a.key === k)?.score ?? null;
  const out: Fact[] = [];
  if (!prof.summary.lowData) {
    for (const k of prof.summary.top) out.push({ key: `strength:${k}`, kind: "strength", params: { attr: k, score: score(k) }, hidden: false });
    if (prof.summary.weak) out.push({ key: `weakness:${prof.summary.weak}`, kind: "weakness", params: { attr: prof.summary.weak, score: score(prof.summary.weak) }, hidden: false });
  }
  for (const v of prof.edge?.lose ?? []) out.push({ key: `leak:${v.sliceKey}`, kind: "leak", params: { slice: v.sliceKey, perDay: round2(v.perDay), lo: round2(v.perDayLo), hi: round2(v.perDayHi), trades: v.n, days: v.days }, hidden: false });
  for (const v of prof.edge?.earn ?? []) out.push({ key: `edge:${v.sliceKey}`, kind: "edge", params: { slice: v.sliceKey, perDay: round2(v.perDay), lo: round2(v.perDayLo), hi: round2(v.perDayHi), trades: v.n, days: v.days }, hidden: false });
  return out;
}

async function regimeFacts(trader: string, today: string): Promise<{ regime: string | null; facts: Fact[] }> {
  const day = await regimeDay(today);
  const edge = regimeEdge(await regimeTrades(trader, addDays(today, -365), today), { iters: 300 });
  const facts: Fact[] = [];
  const row = (k: string | null) => (k ? edge.rows.find((r) => r.regime === k) : undefined);
  const today_ = row(day?.regime ?? null);
  if (day && today_) facts.push({ key: "regime:today", kind: "regime", params: { regime: day.regime, role: "today", perDay: round2(today_.perDay.point), trades: today_.trades, days: today_.days, status: today_.status }, hidden: false });
  const leak = row(edge.leak);
  if (leak) facts.push({ key: "regime:leak", kind: "regime", params: { regime: leak.regime, role: "leak", perDay: round2(leak.perDay.point), trades: leak.trades, days: leak.days, status: leak.status }, hidden: false });
  const strong = row(edge.strength);
  if (strong) facts.push({ key: "regime:strength", kind: "regime", params: { regime: strong.regime, role: "strength", perDay: round2(strong.perDay.point), trades: strong.trades, days: strong.days, status: strong.status }, hidden: false });
  return { regime: day?.regime ?? null, facts };
}

async function playbookFacts(trader: string, regime: string | null): Promise<MentorFacts["playbook"]> {
  const pb = await playbookToday(trader);
  const open = pb.setups.filter((s) => !s.locked);
  const ids = open.map((s) => s.id);
  const regimes = new Map<number, string[]>();
  const formulas = new Map<number, StrategyFormula | null>();
  if (ids.length) {
    const { rows } = await pool.query<{ id: number; regimes: string[]; formula: unknown }>(`SELECT id, regimes, formula FROM playbook WHERE id = ANY($1::int[])`, [ids]);
    for (const r of rows) { regimes.set(Number(r.id), r.regimes ?? []); formulas.set(Number(r.id), normFormula(r.formula)); }
  }
  const rank = (v: string | null | undefined) => (v === "best" ? 0 : v === "good" ? 1 : v === "new" ? 2 : 3);
  return open
    .map((s) => ({
      id: s.id, name: s.name.slice(0, 80), fitsRegime: !!regime && (regimes.get(s.id) ?? []).includes(regime), picked: pb.picks.includes(s.id),
      verdict: s.myEdge?.verdict ?? null, trades: s.myEdge?.trades ?? 0, winRate: s.myEdge?.winRate ?? null,
      formula: formulas.get(s.id) ?? null,
    }))
    .sort((a, b) => Number(b.picked) - Number(a.picked) || Number(b.fitsRegime) - Number(a.fitsRegime) || rank(a.verdict) - rank(b.verdict))
    .slice(0, 8);
}

/** Everything the mentor knows about `trader` today. */
export async function gatherFacts(trader: string, today: string): Promise<MentorFacts> {
  const from = addDays(today, -LOOKBACK_DAYS);
  const [stage, hidden, notes, commitments, trades, riskState, checkin, profile, reg, agree, focus, dayTwo, breaks, flow, season, openWindow, pulse, easyMoney] = await Promise.all([
    safe("stage", () => stageOf(trader), null),
    safe("hidden", () => hiddenFacts(trader), [] as string[]),
    safe("notes", () => listNotes(trader), [] as Note[]),
    safe("commitments", () => listCommitments(trader), { active: [] as Commitment[], closed: [] as Commitment[] }),
    safe("trades", () => behaviorTradesOf(trader)(from, today), [] as BehaviorTrade[]),
    safe("risk", () => riskStateOf(trader, today), null),
    safe("checkin", () => checkinOf(trader, today), null),
    safe("profile", () => profileFacts(trader), [] as Fact[]),
    safe("regime", () => regimeFacts(trader, today), { regime: null, facts: [] as Fact[] }),
    safe("agreements", () => agreements(trader), [] as { id: number; title: string; dueOn: string | null }[]),
    safe("focus", () => focusFor(trader, today), null),
    safe("dayTwo", async () => (await dayTwoOf(trader, today, setting("mentor.dayTwoMovePct"))).hints, [] as DayTwoHint[]),
    safe("formula", () => formulaBreaksOf(trader, addDays(today, -FORMULA_LOOKBACK_DAYS), today), [] as FormulaBreak[]),
    safe("flow", async (): Promise<DayFlowFacts | null> => { const f = await dayFlowFactsOf(trader, today); return isEmptyDayFlow(f) ? null : f; }, null),
    safe("season", (): Promise<SeasonDay | null> => seasonDay(today), null),
    safe("openWindow", (): Promise<OpenWindowState | null> => openWindowStateOf(trader, today), null),
    safe("pulse", async (): Promise<MentorFacts["pulse"]> => {
      const p = await deskPulseOf(today);
      return p.works || p.fails ? { works: p.works, fails: p.fails, from: p.from, to: p.to } : null;
    }, null),
    safe("easyMoney", async (): Promise<PersonalEasyMoney | null> => { const x = await personalEasyMoney(trader, today); return x.lines.length ? x : null; }, null),
  ]);
  // Commitments may have started before the lookback: load the older trades only when one needs them.
  const oldest = commitments.active.map((c) => c.startedOn).sort()[0];
  const trackTrades = oldest && oldest < from ? await safe("trades.old", () => behaviorTradesOf(trader)(oldest, today), trades) : trades;
  const active: CommitmentView[] = commitments.active.map((c) => {
    const progress = trackCommitment(c, trackTrades);
    return { ...c, progress, verdict: commitmentVerdict(progress) };
  });
  const tiltDays = new Set<string>();
  const mistakes = trades.length ? await safe("mistakes", () => mistakesByTrade(trader, from, today), new Map<number, string[]>()) : new Map<number, string[]>();
  const dayOf = new Map(trades.map((t) => [t.id, t.date]));
  for (const [id, ms] of mistakes) if (ms.some((m) => TILT_MISTAKES.has(m))) { const d = dayOf.get(id); if (d) tiltDays.add(d); }

  const stageFact: Fact[] = stage ? [{ key: "stage", kind: "stage", params: { stage }, hidden: false }] : [];
  const agreementFacts: Fact[] = agree.map((a) => ({ key: `agreement:${a.id}`, kind: "agreement", params: { title: a.title, dueOn: a.dueOn }, hidden: false }));
  const focusFact: Fact[] = focus && (focus.mistake || focus.ownText)
    ? [{ key: "focus", kind: "focus", params: { mistake: focus.mistake, costNet: focus.costNet, count: focus.count, own: focus.ownText ?? null }, hidden: false }]
    : [];
  const hiddenSet = new Set(hidden);
  const facts = [...stageFact, ...profile, ...reg.facts, ...agreementFacts, ...focusFact].map((f) => ({ ...f, hidden: hiddenSet.has(f.key) }));
  const days = dayStats(trades, riskState?.days ?? []);
  return {
    trader, today, stage, facts, notes,
    commitments: { active, closed: commitments.closed },
    checkin, days, tiltDays,
    risk: riskState ? riskSummary(riskState) : UNKNOWN_RISK,
    regime: reg.regime,
    playbook: hiddenSet.has("playbook") ? [] : await safe("playbook", () => playbookFacts(trader, reg.regime), []),
    focus: focus ? { mistake: focus.mistake, costNet: focus.costNet, count: focus.count, own: focus.ownText ?? null } : null,
    dayTwo: hiddenSet.has("playbook") ? dayTwo.map((h) => ({ ...h, setupId: null, setupName: null })) : dayTwo,
    formulaBreaks: hiddenSet.has("playbook") ? [] : breaks,
    flow,
    season,
    openWindow,
    pulse,
    easyMoney,
  };
}

/** Traded-day rows for the escalation rules. */
export function tradedDays(f: Pick<MentorFacts, "days" | "tiltDays">): TradedDay[] {
  return f.days.map((d) => ({ day: d.day, trades: d.trades, net: d.net, tilt: f.tiltDays.has(d.day) }));
}

/** The Monday of the week of `day` (weekly rhythm period) and that week's weekdays up to `day`. */
export function weekOf(day: string): { monday: string; days: string[] } {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  const monday = addDays(day, -((dow + 6) % 7));
  return { monday, days: lastWeekdays(day, 5).filter((d) => d >= monday) };
}
