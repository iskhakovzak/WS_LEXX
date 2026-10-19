/**
 * Earned / active titles for many traders at once (rankings, GET /api/gamification/titles): stored achievement tiers +
 * stored mastery level 4 (lib/gamification/titles.ts maps them), checked against the chosen title. A trader halted by the
 * risk desk shows no title while halted (./halted.ts; the title stays earned and chosen).
 */
import { pool } from "@workspace/db";
import { codeFromName } from "../playbookToday/build";
import { haltedTraders } from "./halted";
import { chosenTitles } from "./people";
import { activeTitleOf, MASTER_LEVEL, TITLE_BY_TIER, titlesOf, type TitleAchievement, type TitleMastery } from "./titles";

const relevantPairs = Object.keys(TITLE_BY_TIER);

export async function earnedTitles(traders: readonly string[]): Promise<Map<string, { key: string; earnedAt: string }[]>> {
  const out = new Map<string, { key: string; earnedAt: string }[]>();
  if (!traders.length) return out;
  const [ach, mastery] = await Promise.all([
    pool
      .query<{ trader: string; line: string; tier: string; earned_on: string }>(
        `SELECT trader, line, tier, earned_on FROM trader_achievements WHERE trader = ANY($1::text[]) AND (line || ':' || tier) = ANY($2::text[])`,
        [traders, relevantPairs],
      )
      .catch(() => ({ rows: [] as { trader: string; line: string; tier: string; earned_on: string }[] })),
    pool
      .query<{ trader: string; setup_id: number; level: number; level_on: string; name: string | null }>(
        `SELECT m.trader, m.setup_id, m.level, m.level_on, p.name FROM setup_mastery m LEFT JOIN playbook p ON p.id = m.setup_id
          WHERE m.trader = ANY($1::text[]) AND m.level >= $2`,
        [traders, MASTER_LEVEL],
      )
      .catch(() => ({ rows: [] as { trader: string; setup_id: number; level: number; level_on: string; name: string | null }[] })),
  ]);
  const a = new Map<string, TitleAchievement[]>();
  for (const r of ach.rows) (a.get(r.trader) ?? a.set(r.trader, []).get(r.trader)!).push({ line: r.line, tier: r.tier, date: String(r.earned_on) });
  const m = new Map<string, TitleMastery[]>();
  for (const r of mastery.rows) {
    (m.get(r.trader) ?? m.set(r.trader, []).get(r.trader)!).push({ setupId: Number(r.setup_id), code: codeFromName(r.name), level: Number(r.level), levelOn: String(r.level_on) });
  }
  for (const t of traders) out.set(t, titlesOf(a.get(t) ?? [], m.get(t) ?? []));
  return out;
}

/** trader → active title (chosen, still earned, not risk-halted). `traders` omitted = everyone who chose one. */
export async function activeTitles(traders?: readonly string[]): Promise<Map<string, string>> {
  const chosen = await chosenTitles(traders);
  if (!chosen.size) return new Map();
  const [earned, halted] = await Promise.all([earnedTitles([...chosen.keys()]), haltedTraders([...chosen.keys()])]);
  const out = new Map<string, string>();
  for (const [t, key] of chosen) {
    if (halted.has(t)) continue;
    const active = activeTitleOf(key, earned.get(t) ?? []);
    if (active) out.set(t, active);
  }
  return out;
}
