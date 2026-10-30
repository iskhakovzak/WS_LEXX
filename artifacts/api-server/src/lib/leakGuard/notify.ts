/**
 * Leak guard notices through the existing notification system (lib/notifyUtils notifyUser: in-app row, recipient
 * preferences, optional Telegram through the push budget). Type `leak_guard`, rendered per reader by
 * lib/notificationRenderers/leakGuard.ts. Telegram only when GuardConfig.telegram (desk switch leakGuard.telegram,
 * off by default, AND a production API with a bot token — a dev or test API never sends).
 *
 *   trader   variant "trader"  { patternCode, levelCode, usd, minutes?, until? }
 *   curator  variant "ignored" { trader, patternCode, reasonCode: noAck | traded, minutes }
 *   risk     variant "risk"    { trader, patternCode, usd, until? } — hard level: «на паузе», act in the broker's platform
 */
import { pool } from "@workspace/db";
import { notifyUser } from "../notifyUtils";
import { staffOrFallback } from "../notifyEvents";
import { uniqueRecipients } from "../notifyEventsCore";
import type { GuardConfig } from "./types";
import type { GuardEventRow } from "./store";

export const LEAK_GUARD_TYPE = "leak_guard";
const LINK = "/risk";

const usd = (v: number | null): string => `$${Math.round(Math.abs(v ?? 0)).toLocaleString("en-US")}`;
const nyTime = (isoOrNull: string | null): string | undefined => {
  if (!isoOrNull) return undefined;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(isoOrNull));
};

function base(cfg: GuardConfig) {
  return {
    type: LEAK_GUARD_TYPE, source: "risk", link: LINK, entityType: "leak_guard", telegram: cfg.telegram,
  } as const;
}

export async function notifyTrader(e: GuardEventRow, cfg: GuardConfig): Promise<void> {
  const minutes = typeof e.stats.minutes === "number" ? e.stats.minutes : null;
  const s = e.stats;
  // Rule patterns (rules.ts) name the ticker / the entries / the limit instead of a personal cost.
  const rule = {
    ...(typeof s.ticker === "string" ? { ticker: s.ticker } : {}),
    ...(typeof s.entries === "number" ? { entries: s.entries } : {}),
    ...(typeof s.limit === "number" ? { limit: usd(s.limit) } : {}),
  };
  await notifyUser({
    ...base(cfg), userName: e.trader, entityId: e.id, severity: e.level === "soft" ? "info" : "warn",
    params: { variant: "trader", patternCode: e.pattern, levelCode: e.level, usd: usd(e.costPerTrade), minutes, until: nyTime(e.pauseUntil), ...rule },
  });
}

/** Assigned curator / mentor first (their own people), else every active curator / admin. */
export async function curatorsOf(trader: string): Promise<string[]> {
  const { rows } = await pool.query<{ c: string | null; m: string | null }>(
    `SELECT assigned_curator AS c, assigned_mentor AS m FROM users WHERE name = $1 LIMIT 1`, [trader],
  ).catch(() => ({ rows: [] as { c: string | null; m: string | null }[] }));
  const own = [rows[0]?.c, rows[0]?.m].filter((x): x is string => !!x && x !== trader);
  return uniqueRecipients(own.length ? own : await staffOrFallback(trader), trader);
}

/** The assigned risk manager, else the trader's staff / every curator and admin. */
export async function riskManagersOf(trader: string): Promise<string[]> {
  const { rows } = await pool.query<{ r: string | null }>(`SELECT assigned_risk_manager AS r FROM users WHERE name = $1 LIMIT 1`, [trader])
    .catch(() => ({ rows: [] as { r: string | null }[] }));
  const rm = rows[0]?.r;
  return uniqueRecipients(rm && rm !== trader ? [rm] : await staffOrFallback(trader), trader);
}

export async function notifyIgnored(e: GuardEventRow, reason: "noAck" | "traded", cfg: GuardConfig): Promise<void> {
  const params = { variant: "ignored", trader: e.trader, patternCode: e.pattern, reasonCode: reason, minutes: cfg.ackMinutes };
  for (const name of await curatorsOf(e.trader)) {
    await notifyUser({ ...base(cfg), userName: name, entityId: `${e.id}:ignored`, severity: "warn", actor: e.trader, params });
  }
}

export async function notifyRisk(e: GuardEventRow, cfg: GuardConfig): Promise<void> {
  const params = { variant: "risk", trader: e.trader, patternCode: e.pattern, usd: usd(e.costPerTrade), until: nyTime(e.pauseUntil) };
  for (const name of await riskManagersOf(e.trader)) {
    await notifyUser({ ...base(cfg), link: `/risk?trader=${encodeURIComponent(e.trader)}`, userName: name, entityId: `${e.id}:risk`, severity: "critical", actor: e.trader, params });
  }
}
