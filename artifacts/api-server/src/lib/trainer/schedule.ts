/**
 * «Задача дня» pick time — desk setting trainer.dailyPickTime (New York, weekdays; default 08:30). Light module:
 * src/jobs/definitions.ts reads dailyPickCron as a cron getter on every scheduler tick (a saved time takes effect from
 * the next minute); lib/trainer/daily.ts uses pickMinutes for the lazy pick on the first read.
 */
import { SETTINGS, setting } from "../settings/registry";
import { timeToMinutes } from "../settings/validate";
import { weekdayCronAt } from "../daily/telegramSchedule";

/** Minutes after NY midnight of the daily pick. */
export function pickMinutes(): number {
  return timeToMinutes(setting("trainer.dailyPickTime")) ?? (timeToMinutes(SETTINGS["trainer.dailyPickTime"].default) as number);
}

export const dailyPickCron = (): string => weekdayCronAt(pickMinutes());
