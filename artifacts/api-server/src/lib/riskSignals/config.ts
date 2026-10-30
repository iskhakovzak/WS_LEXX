/**
 * Risk signal settings from the desk registry (lib/settings/registry.ts, group «riskSignals»; admin → «Настройки деска»,
 * every change in the settings audit). `signalConfig(read)` is pure for tests; `currentSignalConfig()` reads setting().
 */
import { setting, type SettingKey } from "../settings/registry";
import { dailyTelegramEnabled } from "../daily/telegramGuard";
import type { SignalConfig } from "./types";

type Read = (key: SettingKey) => unknown;

const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

/** `telegramAllowed` = the environment may send at all (production + bot token); the desk switch must be on too. */
export function signalConfig(read: Read, telegramAllowed: boolean): SignalConfig {
  const warn = num(read("riskSignals.stopWarnPct"), 70);
  const critical = num(read("riskSignals.stopCriticalPct"), 90);
  return {
    enabled: bool(read("riskSignals.enabled"), true),
    stopPcts: [...new Set([warn, critical])].sort((a, b) => a - b),
    streakLosses: num(read("riskSignals.streakLosses"), 3),
    revengeWindowMin: num(read("riskSignals.revengeWindowMin"), 10),
    revengeSizeRatio: num(read("riskSignals.revengeSizeRatio"), 1.5),
    revengePaceRatio: num(read("riskSignals.revengePaceRatio"), 2),
    offPlan: bool(read("riskSignals.offPlan"), true),
    newsBeforeMin: num(read("riskSignals.newsBeforeMin"), 5),
    newsAfterMin: num(read("riskSignals.newsAfterMin"), 5),
    lookbackDays: num(read("riskSignals.lookbackDays"), 90),
    savedMinSample: num(read("riskSignals.savedMinSample"), 5),
    telegram: telegramAllowed && bool(read("riskSignals.telegram"), true),
  };
}

export function currentSignalConfig(): SignalConfig {
  return signalConfig((k) => setting(k), dailyTelegramEnabled());
}

/** Fingerprint of the settings the cached baselines depend on. */
export const baselineKey = (c: SignalConfig): string => String(c.lookbackDays);
