// Fixtures of GET /api/quests/me (shapes from lib/quests/types — the contract).
import type { Achievement, Quest, QuestsMe } from "@/lib/quests/types";

export const TODAY = "2026-10-19"; // Monday
export const CURATOR = "Ольга Н."; // seeded curator name (data, the stored id)

let nextId = 1;
export function quest(over: Partial<Quest> & Pick<Quest, "scope" | "template">): Quest {
  const id = over.id ?? nextId++;
  return {
    id,
    title: { key: `quest.${over.template}.title`, params: { target: over.target ?? 1 } },
    description: { key: `quest.${over.template}.desc` },
    progress: 0,
    target: 1,
    status: "active",
    rewardPoints: 10,
    startsOn: TODAY,
    endsOn: TODAY,
    completedAt: null,
    assignedBy: null,
    note: null,
    href: null,
    ...over,
  };
}

export const onboarding: Quest[] = [
  quest({ id: 101, scope: "onboarding", template: "set_pin", status: "done", progress: 1, completedAt: "2026-10-15", endsOn: null, href: "/settings" }),
  quest({ id: 102, scope: "onboarding", template: "link_telegram", status: "done", progress: 1, completedAt: "2026-10-16", endsOn: null }),
  quest({ id: 103, scope: "onboarding", template: "first_plan_stop", status: "done", progress: 1, completedAt: "2026-10-16", endsOn: null }),
  quest({ id: 104, scope: "onboarding", template: "first_review", endsOn: null, href: "/?review=1" }),
  quest({ id: 105, scope: "onboarding", template: "open_desk_day", endsOn: null, href: "/desk-day" }),
  quest({ id: 106, scope: "onboarding", template: "replay_own_day", endsOn: null, href: "/simulator?mode=own" }),
  quest({ id: 107, scope: "onboarding", template: "set_own_rule", endsOn: null, href: "/game-plan?view=my" }),
];

export const daily: Quest[] = [
  quest({ id: 201, scope: "daily", template: "plan_before_open", status: "done", progress: 1, completedAt: `${TODAY}T13:10:00Z`, href: "/game-plan?view=my" }),
  quest({ id: 202, scope: "daily", template: "review_yesterday", href: "/" }),
];

export const weekly = quest({ id: 301, scope: "weekly", template: "contract_days", target: 5, progress: 2, rewardPoints: 25, startsOn: TODAY, endsOn: "2026-10-23" });

export const fromCurator = quest({
  id: 401, scope: "curator", template: "focus_absent_days", target: 3, progress: 1, rewardPoints: 20, endsOn: "2026-10-23",
  assignedBy: CURATOR, note: "Не усредняйся против тренда", href: "/",
});

export const finished: Quest[] = [
  quest({ id: 501, scope: "weekly", template: "review_days", status: "done", target: 5, progress: 5, startsOn: "2026-10-12", endsOn: "2026-10-16", completedAt: "2026-10-16" }),
  quest({ id: 502, scope: "curator", template: "contract_days", status: "failed", target: 5, progress: 3, startsOn: "2026-10-05", endsOn: "2026-10-09", assignedBy: CURATOR }),
];

export const achievements: Achievement[] = [
  {
    id: "contract_streak", category: "discipline", title: { key: "ach.contract_streak.title" }, hint: { key: "ach.contract_streak.hint" },
    current: 7, tier: "bronze", secret: false,
    tiers: [
      { tier: "bronze", target: 5, earnedAt: "2026-10-09" },
      { tier: "silver", target: 10, earnedAt: null },
      { tier: "gold", target: 20, earnedAt: null },
      { tier: "platinum", target: 40, earnedAt: null },
    ],
  },
  {
    id: "reviews_total", category: "review", title: { key: "ach.reviews_total.title" }, hint: { key: "ach.reviews_total.hint" },
    current: 12, tier: null, secret: false,
    tiers: [
      { tier: "bronze", target: 20, earnedAt: null },
      { tier: "silver", target: 50, earnedAt: null },
      { tier: "gold", target: 100, earnedAt: null },
      { tier: "platinum", target: 250, earnedAt: null },
    ],
  },
  {
    id: "beat_yourself", category: "learning", title: { key: "ach.beat_yourself.title" }, hint: { key: "ach.beat_yourself.hint" },
    current: 0, tier: null, secret: true,
    tiers: [{ tier: "bronze", target: 1, earnedAt: null }, { tier: "gold", target: 10, earnedAt: null }],
  },
];

export function me(over: Partial<QuestsMe> = {}): QuestsMe {
  return {
    today: TODAY,
    quests: [...daily, weekly, fromCurator, ...finished],
    achievements,
    summary: { weekDone: 1, weekTotal: 3, achievementsEarned: 1, achievementsTotal: 3, onboarding: null },
    ...over,
  };
}
