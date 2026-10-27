/**
 * Mentor commitments (pure): the closed set of measurable kinds, their parameters, the progress tracked from the
 * trades and the verdict the mentor talks from («пауза после убытка соблюдена 7 из 9 раз»).
 *
 * A commitment counts «opportunities» — the moments it could be kept or broken — and how many were kept:
 *   pause_after_loss   {minutes}  each losing trade: the next entry of that day waited ≥ minutes after its exit
 *                                 (stopping for the day keeps it too)
 *   max_trades         {count}    each traded day: trades ≤ count
 *   max_daily_loss     {usd}      each traded day: day net ≥ −usd
 *   stop_after_losses  {count}    each day with `count` losses in a row: no new entry after the last of them closed
 *   no_entry_before    {time}     each traded day: no entry before HH:MM NY
 *   no_entry_after     {time}     each traded day: no entry after HH:MM NY
 *   max_loss_per_trade {usd}      each trade with a known net: net ≥ −usd
 *   custom             {}         free text (a 1:1 agreement, a habit): not tracked from trades
 * Money is NET (pnl − |fees|). Days are New York trading days. Only trades on or after the start day count.
 */
import { z } from "zod";

export const COMMITMENT_KINDS = [
  "pause_after_loss", "max_trades", "max_daily_loss", "stop_after_losses", "no_entry_before", "no_entry_after", "max_loss_per_trade", "custom",
] as const;
export type CommitmentKind = (typeof COMMITMENT_KINDS)[number];
export const isCommitmentKind = (v: unknown): v is CommitmentKind => typeof v === "string" && (COMMITMENT_KINDS as readonly string[]).includes(v);

/** At most this many active commitments per trader (the mentor replaces one to add another). */
export const MAX_ACTIVE = 3;

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const usd = z.number().positive().max(1_000_000);

export const PARAM_SCHEMAS = {
  pause_after_loss: z.object({ minutes: z.number().int().min(1).max(240) }),
  max_trades: z.object({ count: z.number().int().min(1).max(500) }),
  max_daily_loss: z.object({ usd }),
  stop_after_losses: z.object({ count: z.number().int().min(1).max(20) }),
  no_entry_before: z.object({ time: HHMM }),
  no_entry_after: z.object({ time: HHMM }),
  max_loss_per_trade: z.object({ usd }),
  custom: z.object({}),
} as const satisfies Record<CommitmentKind, z.ZodTypeAny>;

export type CommitmentParams = Record<string, number | string>;

/** Validated params of a kind (numbers rounded to cents), or null when they do not fit. */
export function parseParams(kind: CommitmentKind, raw: unknown): CommitmentParams | null {
  const r = PARAM_SCHEMAS[kind].safeParse(raw ?? {});
  if (!r.success) return null;
  const out: CommitmentParams = {};
  for (const [k, v] of Object.entries(r.data as Record<string, number | string>)) out[k] = typeof v === "number" ? Math.round(v * 100) / 100 : v;
  return out;
}

/** A trade as the tracker needs it (BehaviorTrade has these fields). */
export type TrackTrade = { id: number; date: string; entryAt: number | null; exitAt: number | null; entryMin: number | null; net: number | null };

export type DayMark = { day: string; kept: number; broken: number };

export type Progress = {
  tracked: boolean;
  /** What one opportunity is: a losing trade, a traded day, a trade. */
  unit: "loss" | "day" | "trade" | null;
  opportunities: number;
  kept: number;
  broken: number;
  /** kept / opportunities (null with no opportunity). */
  rate: number | null;
  /** Kept opportunities in a row, counted back from the latest. */
  streak: number;
  /** Per traded day since the start (oldest first). */
  days: DayMark[];
  /** Up to 5 latest breaks (newest first): the trade that broke it (or the day's last trade). */
  breaks: { tradeId: number; day: string }[];
};

export type CommitmentLike = { kind: CommitmentKind; params: CommitmentParams; startedOn: string };

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const UNIT: Record<CommitmentKind, Progress["unit"]> = {
  pause_after_loss: "loss", max_trades: "day", max_daily_loss: "day", stop_after_losses: "day", no_entry_before: "day",
  no_entry_after: "day", max_loss_per_trade: "trade", custom: null,
};

type Outcome = { ok: boolean; tradeId: number };

/** Opportunities of ONE day (trades of that day sorted by entry). */
function dayOutcomes(c: CommitmentLike, ts: readonly TrackTrade[]): Outcome[] {
  const p = c.params;
  const last = ts[ts.length - 1]!;
  const dayNet = ts.reduce((s, t) => s + (t.net ?? 0), 0);
  switch (c.kind) {
    case "max_trades":
      return [{ ok: ts.length <= Number(p.count), tradeId: ts[Math.min(ts.length - 1, Number(p.count))]!.id }];
    case "max_daily_loss":
      return [{ ok: dayNet >= -Number(p.usd), tradeId: last.id }];
    case "no_entry_before": {
      const bad = ts.find((t) => t.entryMin != null && t.entryMin < minutesOf(String(p.time)));
      return [{ ok: !bad, tradeId: (bad ?? last).id }];
    }
    case "no_entry_after": {
      const bad = ts.find((t) => t.entryMin != null && t.entryMin > minutesOf(String(p.time)));
      return [{ ok: !bad, tradeId: (bad ?? last).id }];
    }
    case "max_loss_per_trade":
      return ts.filter((t) => t.net != null).map((t) => ({ ok: (t.net as number) >= -Number(p.usd), tradeId: t.id }));
    case "pause_after_loss": {
      const out: Outcome[] = [];
      const gap = Number(p.minutes) * 60_000;
      for (const loss of ts) {
        if (loss.net == null || loss.net >= 0 || loss.exitAt == null) continue;
        const next = ts.find((t) => t.id !== loss.id && t.entryAt != null && t.entryAt >= (loss.exitAt as number));
        out.push(next ? { ok: (next.entryAt as number) - (loss.exitAt as number) >= gap, tradeId: next.id } : { ok: true, tradeId: loss.id });
      }
      return out;
    }
    case "stop_after_losses": {
      const k = Number(p.count);
      const byExit = [...ts].filter((t) => t.exitAt != null).sort((a, b) => (a.exitAt as number) - (b.exitAt as number));
      let run = 0;
      for (const t of byExit) {
        run = t.net != null && t.net < 0 ? run + 1 : 0;
        if (run < k) continue;
        const after = ts.find((x) => x.entryAt != null && x.entryAt > (t.exitAt as number));
        return [{ ok: !after, tradeId: (after ?? t).id }];
      }
      return [];
    }
    case "custom":
      return [];
  }
}

/** Progress of a commitment over the trades (any order; trades before the start day are ignored). */
export function trackCommitment(c: CommitmentLike, trades: readonly TrackTrade[]): Progress {
  const tracked = c.kind !== "custom";
  const byDay = new Map<string, TrackTrade[]>();
  for (const t of trades) {
    if (!t.date || t.date < c.startedOn) continue;
    const list = byDay.get(t.date) ?? [];
    list.push(t);
    byDay.set(t.date, list);
  }
  const days: DayMark[] = [];
  const seq: { ok: boolean; tradeId: number; day: string }[] = [];
  for (const day of [...byDay.keys()].sort()) {
    const ts = byDay.get(day)!.sort((a, b) => (a.entryAt ?? 0) - (b.entryAt ?? 0) || a.id - b.id);
    const outs = tracked ? dayOutcomes(c, ts) : [];
    const kept = outs.filter((o) => o.ok).length;
    days.push({ day, kept, broken: outs.length - kept });
    for (const o of outs) seq.push({ ...o, day });
  }
  const kept = seq.filter((o) => o.ok).length;
  let streak = 0;
  for (let i = seq.length - 1; i >= 0 && seq[i]!.ok; i--) streak++;
  const breaks = seq.filter((o) => !o.ok).slice(-5).reverse().map((o) => ({ tradeId: o.tradeId, day: o.day }));
  return {
    tracked, unit: UNIT[c.kind], opportunities: seq.length, kept, broken: seq.length - kept,
    rate: seq.length ? Math.round((kept / seq.length) * 1000) / 1000 : null, streak, days, breaks,
  };
}

export type Verdict = "untracked" | "new" | "on_track" | "at_risk" | "failing" | "achieved";

export type VerdictCfg = { targetRate: number; minOpportunities: number; minDays: number };
export const DEFAULT_VERDICT_CFG: VerdictCfg = { targetRate: 0.8, minOpportunities: 8, minDays: 5 };

/**
 * Where a commitment stands: «achieved» = at the target rate over enough opportunities and days, the last 3 kept
 * (the mentor praises and closes it); «failing» = kept less than half the time with enough data (the mentor
 * challenges it or makes it smaller); «new» = fewer than 3 opportunities so far.
 */
export function commitmentVerdict(p: Progress, cfg: VerdictCfg = DEFAULT_VERDICT_CFG): Verdict {
  if (!p.tracked) return "untracked";
  if (p.opportunities < 3 || p.rate == null) return "new";
  const enough = p.opportunities >= cfg.minOpportunities && p.days.length >= cfg.minDays;
  if (p.rate >= cfg.targetRate && enough && p.streak >= 3) return "achieved";
  if (p.rate >= cfg.targetRate) return "on_track";
  if (p.rate < 0.5 && enough) return "failing";
  return "at_risk";
}

/** Breaks of the active commitments by day (the escalation rule «repeated breaks» counts them). */
export function breaksByDay(progress: readonly Progress[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of progress) for (const d of p.days) if (d.broken) out.set(d.day, (out.get(d.day) ?? 0) + d.broken);
  return out;
}
