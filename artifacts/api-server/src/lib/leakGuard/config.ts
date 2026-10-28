/**
 * Guard settings from the desk registry (lib/settings/registry.ts, group «leakGuard»; admin → «Настройки деска»,
 * every change in the settings audit). `guardConfig(read)` is pure for tests; `currentGuardConfig()` reads setting().
 */
import { setting, type SettingKey } from "../settings/registry";
import { WARN_PCT } from "../riskMetrics";
import { dailyTelegramEnabled } from "../daily/telegramGuard";
import { LEVEL_CHOICES, type GuardConfig, type LevelChoice } from "./types";

type Read = (key: SettingKey) => unknown;

const hhmmToMin = (v: unknown, fallback: number): number => {
  const m = typeof v === "string" ? /^(\d{2}):(\d{2})$/.exec(v) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : fallback;
};
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
const level = (v: unknown, fallback: LevelChoice): LevelChoice => (LEVEL_CHOICES as readonly string[]).includes(v as string) ? (v as LevelChoice) : fallback;

/**
 * Pure: the settings → GuardConfig. `telegramAllowed` = the environment may send at all (production + bot token);
 * the desk switch leakGuard.telegram (off by default) must be on as well.
 */
export function guardConfig(read: Read, telegramAllowed: boolean): GuardConfig {
  return {
    enabled: bool(read("leakGuard.enabled"), true),
    patterns: {
      after_loss: bool(read("leakGuard.afterLoss"), true),
      first_trade: bool(read("leakGuard.firstTrade"), true),
      rule_violation: bool(read("leakGuard.ruleViolation"), true),
      near_stop: bool(read("leakGuard.nearStop"), true),
    },
    pauseMinutes: num(read("leakGuard.pauseMinutes"), 10),
    violationPauseMinutes: num(read("leakGuard.violationPauseMinutes"), 30),
    nearStopPauseMinutes: num(read("leakGuard.nearStopPauseMinutes"), 15),
    firstTradeSizeRatio: num(read("leakGuard.firstTradeSizeRatio"), 0.6),
    minOccurrences: num(read("leakGuard.minOccurrences"), 5),
    minCostUsd: num(read("leakGuard.minCostUsd"), 10),
    minTStat: num(read("leakGuard.minTStat"), 1),
    lookbackDays: num(read("leakGuard.lookbackDays"), 90),
    ackMinutes: num(read("leakGuard.ackMinutes"), 3),
    maxEventsPerDay: num(read("leakGuard.maxEventsPerDay"), 6),
    warnShare: WARN_PCT / 100,
    levelByStage: {
      junior: level(read("leakGuard.levelJunior"), "firm"),
      trader: level(read("leakGuard.levelTrader"), "soft"),
      senior: level(read("leakGuard.levelSenior"), "soft"),
    },
    quiet: {
      enabled: bool(read("leakGuard.quietEnabled"), false),
      fromMin: hhmmToMin(read("leakGuard.quietFrom"), 15 * 60 + 50),
      toMin: hhmmToMin(read("leakGuard.quietTo"), 16 * 60),
    },
    telegram: telegramAllowed && bool(read("leakGuard.telegram"), false),
    rules: {
      reentry: bool(read("leakGuard.reentry"), true),
      greenToRed: bool(read("leakGuard.greenToRed"), true),
      openWindow: bool(read("leakGuard.openWindow"), true),
      ideaLimits: bool(read("leakGuard.ideaLimits"), true),
      maxReentries: num(read("flow.maxReentries"), 2),
      g2r: { sizeRatio: num(read("flow.g2rSizeRatio"), 1.3), paceRatio: num(read("flow.g2rPaceRatio"), 1.5), minAfter: num(read("flow.g2rMinAfter"), 2) },
      g2rPauseMinutes: num(read("flow.g2rPauseMinutes"), 15),
    },
  };
}

export function currentGuardConfig(): GuardConfig {
  return guardConfig((k) => setting(k), dailyTelegramEnabled());
}

/** Fingerprint of the settings a personal profile depends on (a change recomputes the cached profiles). */
export function profileKey(c: GuardConfig): string {
  return [c.pauseMinutes, c.violationPauseMinutes, c.nearStopPauseMinutes, c.minOccurrences, c.minCostUsd, c.minTStat, c.lookbackDays,
    Object.values(c.patterns).map(Number).join("")].join("|");
}
