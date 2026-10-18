/**
 * Quest engine — PURE (no I/O), unit-tested. From the trader's data (QuestData) and the stored instances it answers
 * what to create for the current periods and how every active quest stands now. The store applies the plan
 * idempotently (lib/quests/store.ts: catalog instances are unique per trader + scope + template + period, status
 * changes only from «active» — a second process or run changes and notifies nothing twice).
 *
 *   onboarding  the chain in order: a step is created only when every earlier step is done; steps the data already
 *               shows done are created done (points, no notification) and unlock the next one at once
 *   daily       each template on its own when relevant (plan_before_open only before the open)
 *   weekly      once per week: quests.weeklyCount of the relevant templates, rotated by the week number
 *   monthly     once per month: quests.monthlyCount of the relevant templates
 *   expiry      an active quest past its last day (+ the review grace day) becomes «expired»; rules may fail it earlier
 */
import { setting } from "../settings/registry";
import { addDays } from "../tradingDate";
import {
  DAILY, MONTHLY, ONBOARDING, WEEKLY, dailyPeriod, graceEnd, periods, templateOf, weekIndex,
  type Eval, type Period, type QuestData, type StoredQuest, type Template,
} from "./catalog";
import type { Quest, QuestScope, QuestStatus } from "./types";

export type NewQuest = {
  scope: QuestScope; template: string; period: string; target: number; progress: number; status: QuestStatus;
  rewardPoints: number; startsOn: string; endsOn: string | null; completedOn: string | null;
};
export type QuestUpdate = { id: number; progress: number; target: number; status: QuestStatus; completedOn: string | null };
export type QuestPlan = { create: NewQuest[]; update: QuestUpdate[] };

export type EngineOpts = {
  /** The trader may get the onboarding chain (role trader). */
  onboarding: boolean;
};

export type Switches = { enabled: boolean; onboarding: boolean; daily: boolean; weekly: boolean; monthly: boolean; curator: boolean };

export function switches(): Switches {
  const on = setting("quests.enabled");
  return {
    enabled: on,
    onboarding: on && setting("quests.onboardingEnabled"),
    daily: on && setting("quests.dailyEnabled"),
    weekly: on && setting("quests.weeklyEnabled"),
    monthly: on && setting("quests.monthlyEnabled"),
    curator: on && setting("quests.curatorEnabled"),
  };
}

/** One quest now: the template's rule, then the deadline (past the last day + grace → expired). */
export function evaluateQuest(d: QuestData, q: Pick<StoredQuest, "scope" | "template" | "startsOn" | "endsOn" | "target" | "period">): Eval {
  const t = templateOf(q.scope, q.template);
  if (!t) return { progress: 0, target: q.target, status: "active" };
  const e = t.evaluate({ d, q });
  if (e.status === "active" && q.endsOn && d.today > graceEnd(t, q.endsOn)) return { ...e, status: "expired" };
  return e;
}

/** A quest already lost at creation (history before it existed) is not offered. */
const offerable = (n: NewQuest) => n.status !== "failed" && n.status !== "expired";

function fresh(d: QuestData, t: Template, p: Period): NewQuest {
  const target = Math.max(1, t.target(d, p));
  const e = evaluateQuest(d, { scope: t.scope, template: t.key, startsOn: p.startsOn, endsOn: p.endsOn, target, period: p.key });
  return {
    scope: t.scope, template: t.key, period: p.key, target: e.target, progress: e.progress, status: e.status,
    rewardPoints: t.points(), startsOn: p.startsOn, endsOn: p.endsOn, completedOn: e.status === "done" ? d.today : null,
  };
}

/** Rotated pick of `n` from `list`, starting at `offset`. */
export function rotate<T>(list: readonly T[], n: number, offset: number): T[] {
  if (!list.length) return [];
  const k = ((offset % list.length) + list.length) % list.length;
  return [...list.slice(k), ...list.slice(0, k)].slice(0, Math.max(0, n));
}

/** What to create and update for one trader now. */
export function planQuests(d: QuestData, existing: readonly StoredQuest[], o: EngineOpts, sw: Switches = switches()): QuestPlan {
  const update: QuestUpdate[] = [];
  const status = new Map<number, QuestStatus>();
  for (const q of existing) {
    if (q.status !== "active") continue;
    const e = evaluateQuest(d, q);
    status.set(q.id, e.status);
    if (e.status !== q.status || e.progress !== q.progress || e.target !== q.target) {
      update.push({ id: q.id, progress: e.progress, target: e.target, status: e.status, completedOn: e.status === "done" ? d.today : null });
    }
  }
  const create: NewQuest[] = [];
  if (!sw.enabled) return { create, update };
  const has = (scope: QuestScope, template: string, period: string) =>
    existing.find((q) => q.scope === scope && q.template === template && q.period === period);

  if (sw.onboarding && o.onboarding) {
    const p = periods.once(d);
    for (const t of ONBOARDING) {
      const q = has("onboarding", t.key, p.key);
      if (q) {
        const now = status.get(q.id) ?? q.status;
        if (now === "done") continue;
        break;
      }
      const n = fresh(d, t, p);
      create.push(n);
      if (n.status !== "done") break;
    }
  }

  if (sw.daily) {
    for (const t of DAILY) {
      const p = dailyPeriod(t, d);
      if (!p || has("daily", t.key, p.key) || !t.relevant?.(d, p)) continue;
      const n = fresh(d, t, p);
      if (offerable(n)) create.push(n);
    }
  }

  if (sw.weekly) {
    const p = periods.week(d);
    if (!existing.some((q) => q.scope === "weekly" && q.period === p.key)) {
      const relevant = WEEKLY.filter((t) => t.relevant?.(d, p) ?? true).map((t) => fresh(d, t, p)).filter(offerable);
      create.push(...rotate(relevant, setting("quests.weeklyCount"), weekIndex(p.key)));
    }
  }

  if (sw.monthly) {
    const p = periods.month(d);
    if (!existing.some((q) => q.scope === "monthly" && q.period === p.key)) {
      const relevant = MONTHLY.filter((t) => t.relevant?.(d, p) ?? true).map((t) => fresh(d, t, p)).filter(offerable);
      const monthNo = Number(p.key.slice(0, 4)) * 12 + Number(p.key.slice(5, 7));
      create.push(...rotate(relevant, setting("quests.monthlyCount"), monthNo));
    }
  }
  return { create, update };
}

/** The onboarding chain: steps done / total, and the day the last one was done (null while unfinished). */
export function onboardingState(quests: readonly Pick<StoredQuest, "scope" | "template" | "status" | "completedOn">[]): { done: number; total: number; doneOn: string | null } {
  const steps = quests.filter((q) => q.scope === "onboarding" && q.status === "done");
  const done = ONBOARDING.filter((t) => steps.some((q) => q.template === t.key)).length;
  const total = ONBOARDING.length;
  const doneOn = done === total ? steps.map((q) => q.completedOn ?? "").sort().at(-1) || null : null;
  return { done, total, doneOn };
}

// ─── API shape ──────────────────────────────────────────────────────────────

const SCOPE_ORDER: Record<QuestScope, number> = { onboarding: 0, curator: 1, daily: 2, weekly: 3, monthly: 4 };

/** The stored quest as the API answers it (texts as data: `quest.<template>.title|desc`). */
export function toQuest(q: StoredQuest, d: QuestData | null): Quest {
  const t = templateOf(q.scope, q.template);
  const params = { target: q.target, count: q.target, done: q.progress };
  return {
    id: q.id, scope: q.scope, template: q.template,
    title: { key: `quest.${q.template}.title`, params: { target: q.target, count: q.target } },
    description: { key: `quest.${q.template}.desc`, params },
    progress: q.progress, target: q.target, status: q.status === "cancelled" ? "expired" : q.status,
    ...(q.status === "cancelled" ? { cancelled: true } : {}),
    rewardPoints: q.rewardPoints, startsOn: q.startsOn, endsOn: q.endsOn, completedAt: q.completedOn,
    assignedBy: q.assignedBy, note: q.note,
    href: q.status === "active" && t && d ? t.href(d, q) : null,
  };
}

/**
 * Quests to show today: the onboarding chain while unfinished, curator quests (active, or finished / cancelled in the
 * last 7 days — a cancelled one stays in the history, flagged), today's daily quests (and finished today), this week's
 * and this month's. Cancelled catalog quests are never shown.
 */
export function visibleQuests(all: readonly StoredQuest[], today: string, week: string, month: string): StoredQuest[] {
  const onboarding = onboardingState(all);
  const recent = (q: StoredQuest) => (q.completedOn ?? q.endsOn ?? today) >= addDays(today, -7);
  return all
    .filter((q) => {
      if (q.status === "cancelled" && q.scope !== "curator") return false;
      switch (q.scope) {
        case "onboarding": return onboarding.doneOn == null;
        case "curator": return q.status === "active" || recent(q);
        case "daily": return (q.endsOn ?? q.startsOn) >= today || q.completedOn === today;
        case "weekly": return q.period === week;
        case "monthly": return q.period === month;
      }
    })
    .sort((a, b) => SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope] || a.startsOn.localeCompare(b.startsOn) || a.id - b.id);
}

/** Header numbers «Квесты недели»: the week's own quests (weekly scope of the week of `monday`) done / offered. Daily,
 *  monthly, curator and onboarding quests have their own places and do not move this number. */
export function weekSummary(all: readonly StoredQuest[], monday: string, friday: string): { weekDone: number; weekTotal: number } {
  const inWeek = all.filter((q) => q.scope === "weekly" && q.status !== "cancelled" && (q.period === monday || (q.startsOn <= friday && (q.endsOn ?? friday) >= monday)));
  return { weekDone: inWeek.filter((q) => q.status === "done").length, weekTotal: inWeek.length };
}

/** Bonus points of done quests: all time and since `from` (by the day they were done). */
export function questPoints(all: readonly Pick<StoredQuest, "status" | "rewardPoints" | "completedOn">[], from: string): { total: number; recent: number } {
  let total = 0, recent = 0;
  for (const q of all) {
    if (q.status !== "done") continue;
    total += q.rewardPoints;
    if ((q.completedOn ?? "") >= from) recent += q.rewardPoints;
  }
  return { total, recent };
}
