/**
 * Desk settings form — pure model (unit-tested in desk-settings-model.test.ts). Shapes mirror the server
 * (artifacts/api-server/src/lib/settings: registry.ts + store.ts SettingState); the form never hard-codes keys, it
 * renders whatever GET /api/admin/settings returns.
 *
 *   inputOf / parseInput   number ⇄ input text (ratio shown as %, 0.5 ⇄ "50")
 *   checkValue             the server's checks (lib/settings/validate.ts), for inline errors before saving
 *   normalize              a value equal to the default is sent as null («по умолчанию»: no stored override)
 *   nyToTashkent           "16:30" NY → "01:30" Tashkent, +1 day (today's DST offsets)
 */
export type SettingUnit = "usd" | "pct" | "days" | "points" | "minutes" | "count" | "ratio" | "places" | "people" | "shares" | "bars" | "times" | "bp" | "atr" | "quests" | "trades" | "months" | "lessons" | "exams" | "tasks" | "teams" | "tokens" | "seconds";
/**
 * `pilot`: one of the ~10 pilot settings (server registry flag) — shown by default, the rest under «Показать все».
 * `hidden`: edited on its own screen (stage access: «Роли и права» → «Доступ по ступеням»), never in this form.
 */
type Base = { group: string; unit?: SettingUnit; pilot?: true; hidden?: true };
export type SettingDef =
  | (Base & { type: "number"; default: number; min: number; max: number; step?: number })
  | (Base & { type: "time"; default: string })
  | (Base & { type: "boolean"; default: boolean })
  | (Base & { type: "select"; default: string; options: readonly string[] })
  | (Base & { type: "text"; default: string; maxLength: number });
export type SettingValue = number | boolean | string;

/** Stage-dependent settings (server lib/settings/registry: stages / sectionStages) — only the access screen edits them. */
export type StageKey = "junior" | "trader" | "senior";
export type StageList = readonly StageKey[];
export type SectionStages = Readonly<Record<string, StageList>>;
export type AccessDef =
  | (Base & { type: "stages"; default: StageList })
  | (Base & { type: "sectionStages"; default: SectionStages; maxSections: number });
export type AnyValue = SettingValue | StageList | SectionStages;

export interface SettingRow {
  key: string;
  def: SettingDef;
  value: SettingValue | null;
  effective: SettingValue;
  default: SettingValue;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** A row as GET /api/admin/settings sends it, whatever its type (the access screen reads the stage rows). */
export interface AnySettingRow {
  key: string;
  def: SettingDef | AccessDef;
  value: AnyValue | null;
  effective: AnyValue;
  default: AnyValue;
  updatedBy: string | null;
  updatedAt: string | null;
}

const FORM_TYPES: ReadonlySet<string> = new Set(["number", "time", "boolean", "select", "text"]);

/** Rows the generic form renders: known field types, not `hidden` (those have their own screen). */
export function formRows(rows: readonly AnySettingRow[]): SettingRow[] {
  return rows.filter((r): r is SettingRow => FORM_TYPES.has(r.def.type) && !r.def.hidden);
}

export type ProblemKind = "empty" | "type" | "range" | "integer" | "time" | "option" | "unknown" | "duplicate" | "order" | "length";
/** `order` (server: ladders must grow): `after` = the key of the step before, `min` = the smallest value that fits. */
export interface Problem { key: string; kind: ProblemKind; min?: number; max?: number; options?: readonly string[]; after?: string }

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Groups in display order; a group the page does not know goes last, in registry order. */
export const GROUP_ORDER = ["daily", "dayState", "coach", "regime", "season", "leakGuard", "flow", "em", "pulse", "sync", "capital", "mentor", "discipline", "rewards", "quests", "achievements", "gamification", "trainer", "telegram", "alerts", "curator", "academy", "privacy", "nav", "usage"] as const;

/**
 * Rows shown next to another row (OWNER-12: the two streak rules stay together): key → the row it follows. Display
 * only — the key and its server group do not change.
 */
export const SHOW_AFTER: Readonly<Record<string, string>> = {
  "gamification.missedDayBreaksStreak": "discipline.streakOnBreak",
};

/**
 * The pilot settings (docs/PILOT.md §2.5 / §3) — the keys the server registry flags `pilot: true` (the agreement is
 * tested in desk-settings-model.test.ts). The page reads the flag from GET /api/admin/settings; this list is only the
 * fallback for an API build without the flag.
 */
export const PILOT_KEYS = [
  "daily.focusWindowDays", "daily.focusMinDays", "discipline.streakOnBreak", "telegram.morningTime", "telegram.eveningTime",
  "gamification.missedDayBreaksStreak", "nav.simpleForTrainees", "trainer.dailyPlayMinutes", "usage.enabled", "usage.pilotUsers",
] as const;

/** Pilot rows in registry order: by the server flag, or by PILOT_KEYS when no row carries the flag (older API). */
export function pilotRowsOf<T extends Pick<SettingRow, "key" | "def">>(rows: readonly T[]): T[] {
  const flagged = rows.filter((r) => r.def.pilot === true);
  if (flagged.length) return flagged;
  const keys = new Set<string>(PILOT_KEYS);
  return rows.filter((r) => keys.has(r.key));
}

/**
 * What the form shows: every row with «Показать все», else the pilot rows (everything when none is known) plus the
 * rows in `keep` (unsaved edits / server problems never hide behind the filter).
 */
export function visibleRows<T extends Pick<SettingRow, "key" | "def">>(rows: readonly T[], showAll: boolean, keep: ReadonlySet<string> = new Set()): T[] {
  if (showAll) return [...rows];
  const pilot = new Set(pilotRowsOf(rows).map((r) => r.key));
  if (!pilot.size) return [...rows];
  return rows.filter((r) => pilot.has(r.key) || keep.has(r.key));
}

export function groupRows(rows: readonly SettingRow[]): { group: string; rows: SettingRow[] }[] {
  const by = new Map<string, SettingRow[]>();
  const present = new Set(rows.map((r) => r.key));
  const moved = rows.filter((r) => SHOW_AFTER[r.key] && present.has(SHOW_AFTER[r.key]!));
  const movedKeys = new Set(moved.map((r) => r.key));
  for (const r of rows) {
    if (movedKeys.has(r.key)) continue;
    const g = r.def.group || "other";
    const l = by.get(g);
    if (l) l.push(r); else by.set(g, [r]);
    for (const x of moved) if (SHOW_AFTER[x.key] === r.key) by.get(g)!.push(x);
  }
  const known = GROUP_ORDER.filter((g) => by.has(g));
  const rest = [...by.keys()].filter((g) => !(GROUP_ORDER as readonly string[]).includes(g));
  return [...known, ...rest].map((group) => ({ group, rows: by.get(group)! }));
}

const isRatio = (d: SettingDef) => d.type === "number" && d.unit === "ratio";
const round = (v: number, dp = 6) => Math.round(v * 10 ** dp) / 10 ** dp;

/** Number as shown in the input / text (ratio → percent). */
export function shownNumber(def: SettingDef, v: number): number {
  return isRatio(def) ? round(v * 100, 4) : v;
}

/** Bounds and step as shown (ratio → percent). */
export function shownBounds(def: Extract<SettingDef, { type: "number" }>): { min: number; max: number; step: number } {
  const k = isRatio(def) ? 100 : 1;
  return { min: round(def.min * k, 4), max: round(def.max * k, 4), step: round((def.step ?? (isRatio(def) ? 0.01 : 1)) * k, 4) };
}

export function inputOf(def: SettingDef, v: SettingValue): string {
  return def.type === "number" && typeof v === "number" ? String(shownNumber(def, v)) : String(v);
}

/** Input text → stored number (ratio: percent → share) or a problem. */
/** «HH:MM», 24 h. */
export function isHhMm(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** Typed time → «HH:MM» (24 h) or null: «845» / «8:45» → «08:45», «1630» → «16:30». */
export function normalizeHhMm(raw: string): string | null {
  const s = raw.trim();
  const m = /^(\d{1,2}):?(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Typed text → value: numbers (ratio shown as %), and «HH:MM» 24-h times (OWNER-30: a text box, not the 12-h native input). */
export function parseInput(key: string, def: SettingDef, text: string): { ok: true; value: number | string } | { ok: false; problem: Problem } {
  if (def.type === "time") {
    const v = normalizeHhMm(text);
    return v ? { ok: true, value: v } : { ok: false, problem: { key, kind: text.trim() ? "time" : "empty" } };
  }
  const s = text.trim().replace(",", ".").replace("−", "-");
  if (!s) return { ok: false, problem: { key, kind: "empty" } };
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { ok: false, problem: { key, kind: "type" } };
  const n = Number(s);
  return { ok: true, value: isRatio(def) ? round(n / 100) : n };
}

/** The server's validation (lib/settings/validate.ts); bounds in the problem are as shown (percent for ratios). */
export function checkValue(key: string, def: SettingDef, v: SettingValue): Problem | null {
  switch (def.type) {
    case "number": {
      if (typeof v !== "number" || !Number.isFinite(v)) return { key, kind: "type" };
      if (v < def.min || v > def.max) {
        const b = shownBounds(def);
        return { key, kind: "range", min: b.min, max: b.max };
      }
      if (def.step != null && Number.isInteger(def.step) && !Number.isInteger(v)) return { key, kind: "integer" };
      return null;
    }
    case "time":
      return typeof v === "string" && TIME_RE.test(v) ? null : { key, kind: "time" };
    case "boolean":
      return typeof v === "boolean" ? null : { key, kind: "type" };
    case "select":
      return typeof v === "string" && def.options.includes(v) ? null : { key, kind: "option" };
    case "text":
      if (typeof v !== "string") return { key, kind: "type" };
      return v.trim().length <= def.maxLength ? null : { key, kind: "length", max: def.maxLength };
  }
}

/** A server problem's bounds converted to what the field shows (ratio → percent). */
export function shownProblem(def: SettingDef | undefined, p: Problem): Problem {
  if (!def || !isRatio(def) || p.kind !== "range") return p;
  return { ...p, min: p.min == null ? p.min : round(p.min * 100, 4), max: p.max == null ? p.max : round(p.max * 100, 4) };
}

/** null when the value is the default («по умолчанию»), else the value. */
export function normalize(row: SettingRow, v: SettingValue | null): SettingValue | null {
  return v === null || v === row.default ? null : v;
}

/** Draft entries that differ from what is stored, as the PUT batch. */
export function changesOf(rows: readonly SettingRow[], draft: Readonly<Record<string, SettingValue | null>>): { key: string; value: SettingValue | null }[] {
  const out: { key: string; value: SettingValue | null }[] = [];
  for (const r of rows) {
    if (!(r.key in draft)) continue;
    const v = normalize(r, draft[r.key]);
    if (v !== r.value) out.push({ key: r.key, value: v });
  }
  return out;
}

// ─── New York → Tashkent ────────────────────────────────────────────────────

/** Minutes east of UTC of `timeZone` at `at`. */
export function tzOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(at);
  const get = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
  return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/** "HH:MM" New York → Tashkent time on the day of `at` (today's offsets): { time, dayShift: −1 | 0 | 1 }. */
export function nyToTashkent(hhmm: string, at: Date = new Date()): { time: string; dayShift: number } | null {
  if (!TIME_RE.test(hhmm)) return null;
  const ny = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const t = ny - tzOffsetMinutes("America/New_York", at) + tzOffsetMinutes("Asia/Tashkent", at);
  const dayShift = Math.floor(t / 1440);
  const m = ((t % 1440) + 1440) % 1440;
  return { time: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`, dayShift };
}
