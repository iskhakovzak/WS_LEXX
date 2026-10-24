/**
 * «Фоновые задачи» — pure helpers (unit-tested in jobs-model.test.ts, OWNER-15): a cron line as words, the status a job
 * row shows (failures in the last 24 h turn «Успешно» into «С перебоями»), and which jobs message people (a manual run
 * asks for confirmation first).
 */

export type CronText =
  | { kind: "daily"; time: string }
  | { kind: "weekdays"; time: string }
  | { kind: "weekly"; day: number; time: string }
  | { kind: "every"; minutes: number; weekdays: boolean; from?: string; to?: string }
  | { kind: "raw"; cron: string };

const pad = (n: number) => String(n).padStart(2, "0");
const isInt = (s: string) => /^\d+$/.test(s);

/**
 * Parses the cron shapes the registry uses (5 fields, New York time). Anything else → raw (shown as is).
 *   "0 5 * * *" → daily 05:00 · "30 18 * * 1-5" → weekdays 18:30 · "0 17 * * 5" → weekly Friday 17:00
 *   "*\/15 9-16 * * 1-5" → every 15 min on weekdays 09:00–17:00 · "7-59/15 * * * *" → every 15 min
 */
export function parseCron(cron: string): CronText {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return { kind: "raw", cron };
  const [min, hour, dom, mon, dow] = f as [string, string, string, string, string];
  if (dom !== "*" || mon !== "*") return { kind: "raw", cron };
  const weekdays = dow === "1-5";
  if (dow !== "*" && !weekdays && !(isInt(dow) && Number(dow) <= 7)) return { kind: "raw", cron };
  const step = /^(?:\*|\d+-59)\/(\d+)$/.exec(min);
  if (step) {
    const minutes = Number(step[1]);
    if (hour === "*") return { kind: "every", minutes, weekdays };
    const range = /^(\d+)-(\d+)$/.exec(hour);
    if (range && isInt(dow) === false) {
      return { kind: "every", minutes, weekdays, from: `${pad(Number(range[1]))}:00`, to: `${pad(Math.min(24, Number(range[2]) + 1))}:00` };
    }
    return { kind: "raw", cron };
  }
  if (!isInt(min) || !isInt(hour) || Number(min) > 59 || Number(hour) > 23) return { kind: "raw", cron };
  const time = `${pad(Number(hour))}:${pad(Number(min))}`;
  if (dow === "*") return { kind: "daily", time };
  if (weekdays) return { kind: "weekdays", time };
  return { kind: "weekly", day: Number(dow) % 7, time };
}

export type JobState = "running" | "ok" | "flaky" | "error" | "timeout" | "skipped" | "never" | "disabled";

/** What the status pill says: a last success with failures in the last 24 h is «С перебоями», not «Успешно». */
export function jobState(j: { running: boolean; enabled: boolean; last: { status: string } | null; failures24h: number }): JobState {
  if (j.running) return "running";
  if (!j.enabled) return "disabled";
  const s = j.last?.status;
  if (!s) return "never";
  if (s === "ok") return j.failures24h > 0 ? "flaky" : "ok";
  if (s === "error" || s === "timeout" || s === "skipped") return s;
  return "never";
}

/** Jobs whose run sends messages to people (Telegram, digests): «Запустить» asks first. */
export function sendsMessages(name: string): boolean {
  return name.startsWith("telegram.") || name.startsWith("digest.") || name === "psychology.weekly-report" || name === "curator.digest";
}
