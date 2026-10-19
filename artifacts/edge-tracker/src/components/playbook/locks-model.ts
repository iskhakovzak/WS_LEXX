/** «Уровни доступа» table (locks-overview.tsx) — pure: the ladder and which level sees each office setup open. */
import type { PlaybookEntry } from "./model";

export const LADDER = ["trainee", "junior", "trader", "senior"] as const;
export type LadderKey = (typeof LADDER)[number];
const RANK: Record<string, number> = { trainee: 0, junior: 1, trader: 2, senior: 3, lead: 4 };

/** «1.3 ORB» → sort key 1.03; names without a code go last, by name. */
const codeKey = (name: string) => {
  const m = /^\s*(\d{1,2})\.(\d{1,2})(?=\s|$)/.exec(name);
  return m ? Number(m[1]) + Number(m[2]) / 100 : Number.POSITIVE_INFINITY;
};

/** Rows by setup code; `open[level]` = the level ranks at or above the setup's min tier (no tier = open to all). */
export function lockRows(entries: PlaybookEntry[]): { entry: PlaybookEntry; open: Record<LadderKey, boolean> }[] {
  return [...entries]
    .sort((a, b) => codeKey(a.name) - codeKey(b.name) || a.name.localeCompare(b.name))
    .map((entry) => {
      const need = entry.minTier && entry.minTier in RANK ? RANK[entry.minTier] : 0;
      const open = Object.fromEntries(LADDER.map((k) => [k, RANK[k] >= need])) as Record<LadderKey, boolean>;
      return { entry, open };
    });
}
