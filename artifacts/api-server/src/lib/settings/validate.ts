/**
 * Desk settings — validation of one value against its registry definition (pure; lib/settings/store.ts and the route
 * use it, tests cover it). `null` always means «back to the default».
 *
 *   number   finite, min ≤ v ≤ max; an integer step (days, points, counts, $5) ⇒ whole numbers only
 *   time     "HH:MM", 00:00–23:59 (New York time)
 *   boolean  true / false
 *   select   one of the declared options
 *   text     a string, trimmed, control characters removed, ≤ maxLength
 *
 * A rejected value comes back as a problem the admin page can show next to the field (SETTINGS_INVALID details).
 * Ladders (level thresholds rewards.level1..4Points, each achievement line's tier targets achievements.<line>1..n) must
 * grow strictly: kind "order" on the step that is not above the one before it (`after` = that key, `min` = the
 * smallest value that fits), checked on the values in force after the batch.
 */
import { SETTINGS, setting, type SettingDef, type SettingKey } from "./registry";

export type SettingProblemKind = "unknown" | "duplicate" | "type" | "range" | "integer" | "time" | "option" | "order" | "length";
export type SettingProblem = {
  key: string;
  kind: SettingProblemKind;
  /** order: the step this one must be above. */
  after?: string;
  min?: number;
  max?: number;
  options?: readonly string[];
};
export type StoredValue = number | boolean | string;

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS, key);
}

export function settingDef(key: string): SettingDef | undefined {
  return isSettingKey(key) ? (SETTINGS[key] as SettingDef) : undefined;
}

/** "HH:MM" → minutes after midnight (null when malformed). */
export function timeToMinutes(v: string): number | null {
  if (!TIME_RE.test(v)) return null;
  return Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
}

/** Checks `value` for `key`. ok → the value to store (null = reset; numbers normalised to 6 decimals). */
export function validateSetting(key: string, value: unknown): { ok: true; value: StoredValue | null } | { ok: false; problem: SettingProblem } {
  const def = settingDef(key);
  if (!def) return { ok: false, problem: { key, kind: "unknown" } };
  if (value === null) return { ok: true, value: null };
  switch (def.type) {
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, problem: { key, kind: "type" } };
      if (value < def.min || value > def.max) return { ok: false, problem: { key, kind: "range", min: def.min, max: def.max } };
      if (def.step != null && Number.isInteger(def.step) && !Number.isInteger(value)) return { ok: false, problem: { key, kind: "integer" } };
      return { ok: true, value: Math.round(value * 1e6) / 1e6 };
    }
    case "time":
      if (typeof value !== "string") return { ok: false, problem: { key, kind: "type" } };
      return TIME_RE.test(value) ? { ok: true, value } : { ok: false, problem: { key, kind: "time" } };
    case "boolean":
      return typeof value === "boolean" ? { ok: true, value } : { ok: false, problem: { key, kind: "type" } };
    case "select":
      if (typeof value !== "string") return { ok: false, problem: { key, kind: "type" } };
      return def.options.includes(value) ? { ok: true, value } : { ok: false, problem: { key, kind: "option", options: def.options } };
    case "text": {
      if (typeof value !== "string") return { ok: false, problem: { key, kind: "type" } };
      const v = [...value].map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch)).join("").trim();
      return v.length <= def.maxLength ? { ok: true, value: v } : { ok: false, problem: { key, kind: "length", max: def.maxLength } };
    }
  }
}

/** A stored value that no longer fits its definition (bounds narrowed, type changed) reads as the default. */
export function storedOrNull(key: string, value: unknown): StoredValue | null {
  if (value === null || value === undefined) return null;
  const r = validateSetting(key, value);
  return r.ok ? r.value : null;
}

/** Ladders that must grow strictly, in step order: the level thresholds and every achievement line's tier targets. */
export function settingLadders(): SettingKey[][] {
  const groups = new Map<string, { n: number; key: SettingKey }[]>();
  for (const key of Object.keys(SETTINGS) as SettingKey[]) {
    const m = /^(rewards\.level)(\d)Points$/.exec(key) ?? /^(achievements\.[A-Za-z]+?)(\d)$/.exec(key);
    if (!m) continue;
    const list = groups.get(m[1]!) ?? [];
    list.push({ n: Number(m[2]), key });
    groups.set(m[1]!, list);
  }
  return [...groups.values()].filter((l) => l.length > 1).map((l) => l.sort((a, b) => a.n - b.n).map((x) => x.key));
}

/** Ladder steps that do not grow over the values in force after `changes` (null = the default). */
export function ladderProblems(changes: ReadonlyMap<string, StoredValue | null>): SettingProblem[] {
  const value = (k: SettingKey): number => {
    if (changes.has(k)) return Number(changes.get(k) ?? SETTINGS[k].default);
    return Number(setting(k));
  };
  const out: SettingProblem[] = [];
  for (const ladder of settingLadders()) {
    if (!ladder.some((k) => changes.has(k))) continue; // only a batch that touches the ladder is judged by it
    for (let i = 1; i < ladder.length; i++) {
      const prev = ladder[i - 1]!, key = ladder[i]!;
      if (value(key) <= value(prev)) out.push({ key, kind: "order", after: prev, min: value(prev) + 1 });
    }
  }
  return out;
}

/** Validates a batch: every key once, all valid — else every problem (nothing is written on any problem). */
export function validateBatch(changes: readonly { key: string; value?: unknown }[]): { ok: true; values: { key: SettingKey; value: StoredValue | null }[] } | { ok: false; problems: SettingProblem[] } {
  const problems: SettingProblem[] = [];
  const values: { key: SettingKey; value: StoredValue | null }[] = [];
  const seen = new Set<string>();
  for (const c of changes) {
    if (seen.has(c.key)) { problems.push({ key: c.key, kind: "duplicate" }); continue; }
    seen.add(c.key);
    const r = validateSetting(c.key, c.value);
    if (!r.ok) problems.push(r.problem);
    else values.push({ key: c.key as SettingKey, value: r.value });
  }
  if (!problems.length) problems.push(...ladderProblems(new Map(values.map((v) => [v.key, v.value]))));
  return problems.length ? { ok: false, problems } : { ok: true, values };
}
