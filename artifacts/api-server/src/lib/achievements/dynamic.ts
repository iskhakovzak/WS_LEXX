/**
 * Achievements v2 — the lines that exist per trader (PURE): one per tagged playbook setup («Мастер сетапа», bronze /
 * silver / gold by a confirmed edge, lib/achievements/mastery.ts), one per closed leak (lib/achievements/leaks.ts) and
 * one per step of the academy path passed on the current stage. Their ids carry the subject:
 *
 *   setup:<playbookId>            tiers bronze / silver / gold, a card each; can be lost (decay) — shown honestly
 *   leak:<sliceKey>               one tier (gold), grouped under the «leaks_closed» card as an item
 *   path:<nextStage>:<metric>     one tier (gold), grouped under the «path_steps» card as an item
 *
 * The count lines (leaks_closed, setups_confirmed, path_steps) are counted from these (stored days win).
 */
import type { AchievementItem, AchievementTier, TextItem } from "../quests/types";
import type { LeakState } from "./leaks";
import type { SetupMasteryState } from "./mastery";
import { MASTERY_TIERS } from "./mastery";

export type StoredAward = { date: string; target: number; lostOn?: string | null; detail?: Record<string, unknown> | null };
export type AwardMap = ReadonlyMap<string, StoredAward>;
const key = (line: string, tier: string) => `${line}|${tier}`;

export type PathInput = {
  /** Stage the trader is on and the next one (the path card «До Трейдера»). */
  stage: string | null;
  next: string | null;
  /** The next stage's criteria now (metric + passes). */
  steps: readonly { metric: string; ok: boolean }[];
};

export type DynamicInput = {
  asOf: string;
  mastery: readonly SetupMasteryState[];
  setupNames: ReadonlyMap<number, string>;
  leaks: readonly LeakState[];
  path: PathInput | null;
};

export type DynResult = {
  id: string;
  kind: "setup" | "leak" | "path";
  tiers: { tier: AchievementTier; target: number; earnedOn: string | null }[];
  /** Tier held now (setup mastery) — null when none. Leak / path: the gold tier while it holds. */
  held: AchievementTier | null;
  /** The day a held tier stopped holding (to store; null = holds / never earned). */
  lostOn: string | null;
  detail: Record<string, unknown>;
  title: TextItem;
  hint: TextItem;
  info: TextItem | null;
};

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

function setupLines(input: DynamicInput, awarded: AwardMap, targets: readonly [number, number, number]): DynResult[] {
  return input.mastery.map((m) => {
    const id = `setup:${m.setupId}`;
    const name = input.setupNames.get(m.setupId) ?? `#${m.setupId}`;
    const tiers = MASTERY_TIERS.map((tier, i) => ({ tier, target: targets[i]!, earnedOn: m.earnedOn[tier] }));
    const stored = MASTERY_TIERS.filter((t) => awarded.has(key(id, t)) || m.earnedOn[t]);
    const top = stored[stored.length - 1] ?? null;
    const heldRank = m.held ? MASTERY_TIERS.indexOf(m.held as (typeof MASTERY_TIERS)[number]) : -1;
    const lost = top != null && MASTERY_TIERS.indexOf(top) > heldRank;
    const e = m.estimate;
    return {
      id, kind: "setup" as const, tiers, held: m.held, lostOn: lost ? (awarded.get(key(id, top!))?.lostOn ?? input.asOf) : null,
      detail: { setupId: m.setupId, name },
      title: { key: "ach.setup.title", params: { name } },
      hint: { key: "ach.setup.hint", params: { name } },
      info: e
        ? { key: e.metric === "r" ? "ach.setup.infoR" : "ach.setup.infoBps", params: { theta: round(e.theta), lo: round(e.lo80), n: e.n, days: e.days, tag: Math.round(m.tagShare * 100) } }
        : null,
    };
  });
}

function leakLines(input: DynamicInput, awarded: AwardMap): DynResult[] {
  return input.leaks.map((l) => {
    const id = `leak:${l.sliceKey}`;
    const stored = awarded.get(key(id, "gold"));
    const earned = stored?.date ?? l.closedOn;
    return {
      id, kind: "leak" as const, tiers: [{ tier: "gold" as const, target: 1, earnedOn: l.closedOn }],
      held: earned && !l.reopenedOn ? "gold" : null, lostOn: earned && l.reopenedOn ? (stored?.lostOn ?? l.reopenedOn) : null,
      detail: { slice: l.sliceKey, method: l.method, flaggedOn: l.flaggedOn },
      title: { key: "ach.leak.title", params: { slice: l.sliceKey } },
      hint: { key: "ach.leak.hint", params: { slice: l.sliceKey, count: l.progress.need } },
      info: { key: "ach.leak.progress", params: { done: Math.min(l.progress.trades, l.progress.need), count: l.progress.need, slice: l.sliceKey } },
    };
  });
}

function pathLines(input: DynamicInput): DynResult[] {
  const p = input.path;
  if (!p?.next) return [];
  return p.steps.map((s) => ({
    id: `path:${p.next}:${s.metric}`, kind: "path" as const,
    tiers: [{ tier: "gold" as const, target: 1, earnedOn: s.ok ? input.asOf : null }],
    held: s.ok ? ("gold" as const) : null, lostOn: null,
    detail: { stage: p.next, metric: s.metric },
    title: { key: "ach.path.title", params: { metric: s.metric, stage: p.next } },
    hint: { key: "ach.path.hint", params: { metric: s.metric, stage: p.next } },
    info: null,
  }));
}

export function dynamicLines(input: DynamicInput, awarded: AwardMap, masteryTargets: readonly [number, number, number], off: (id: string) => boolean): DynResult[] {
  return [
    ...(off("setups_confirmed") ? [] : setupLines(input, awarded, masteryTargets)),
    ...(off("leaks_closed") ? [] : leakLines(input, awarded)),
    ...(off("path_steps") ? [] : pathLines(input)),
  ];
}

/** Days for the count lines, stored days first (awarded once), then this run's. */
export function countDates(dyn: readonly DynResult[], awarded: AwardMap, kind: DynResult["kind"], tier: AchievementTier, prefix: string): string[] {
  const out = new Map<string, string>();
  for (const [k, v] of awarded) {
    const [line, t] = k.split("|");
    if (line!.startsWith(prefix) && t === tier) out.set(line!, v.date);
  }
  for (const d of dyn) {
    if (d.kind !== kind || out.has(d.id)) continue;
    const t = d.tiers.find((x) => x.tier === tier);
    if (t?.earnedOn) out.set(d.id, t.earnedOn);
  }
  return [...out.values()];
}

/** Items of a count card: closed / open leaks, path steps of the current stage (done with the day, or open). */
export function itemsOf(dyn: readonly DynResult[], awarded: AwardMap, kind: "leak" | "path"): AchievementItem[] {
  return dyn
    .filter((d) => d.kind === kind)
    .map((d): AchievementItem => {
      const stored = awarded.get(key(d.id, "gold"));
      const earnedOn = stored?.date ?? d.tiers[0]?.earnedOn ?? null;
      const state: AchievementItem["state"] = earnedOn ? (d.lostOn ? "lost" : "done") : "open";
      return { key: d.id, label: d.title, earnedOn, state, info: state === "open" ? d.info : null, lostOn: d.lostOn };
    })
    .sort((a, b) => Number(a.state === "open") - Number(b.state === "open") || (b.earnedOn ?? "").localeCompare(a.earnedOn ?? "") || a.key.localeCompare(b.key));
}
