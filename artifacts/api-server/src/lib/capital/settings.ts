/** The engine's desk settings (lib/settings/registry `capital.*`, Админка → Настройки → «Распределение риска»). */
import { setting } from "../settings/registry";
import type { CapitalSettings } from "./types";

export function capitalSettings(): CapitalSettings {
  return {
    weights: {
      edge: setting("capital.weightEdge"), regime: setting("capital.weightRegime"), discipline: setting("capital.weightDiscipline"),
      achievements: setting("capital.achievementsEnabled") && setting("achievements.enabled") ? setting("capital.weightAchievements") : 0,
    },
    maxStepUpPct: setting("capital.maxStepUpPct"),
    maxStepDownPct: setting("capital.maxStepDownPct"),
    minStepPct: setting("capital.minStepPct"),
    minTrades: setting("capital.minTrades"),
    windowDays: setting("capital.windowDays"),
    includeJuniors: setting("capital.includeJuniors"),
    disciplineGate: setting("capital.disciplineGate"),
    disciplineCut: setting("capital.disciplineCut"),
    floorPctOfTier: setting("capital.floorPctOfTier"),
    capPctOfTier: setting("capital.capPctOfTier"),
    maxDeskGrowthPct: setting("capital.maxDeskGrowthPct"),
  };
}

/** «автоприменение»: the weekly job applies its proposals itself (off by default; the button never does). */
export const autoApplyOn = (): boolean => setting("capital.autoApply") === true;
