/**
 * Setup tag = a playbook setup (wave 1, 1.2). Every place that tags a trade with a setup — the S picker and bulk
 * tagging on /trades, the evening journal, the auto-classifier's «принять» — writes `trades.playbook_id` and keeps
 * `trades.setup` (text) in sync as that setup's name. «Без сетапа», the tag_yesterday quest, setup edge / unlocks and
 * mastery read `playbook_id` only (lib/playbookToday/untagged, service, gamification/mastery).
 *
 *   loadOfficeSetups()            the office setups (space «office»: the desk's 16), cached 60 s
 *   matchOfficeSetup(text, list)  «1.3 ORB 5 минут» / «1.3» / «orb 5 минут»-insensitive name → the office setup
 *   resolveSetupLink(input, owner) { playbookId?, setup? } of a write → the pair to store (throws SETUP_NOT_FOUND)
 *   officeCodeForClass(name)      classifier class (canonical name / code) → office setup number (CLASS_TO_OFFICE)
 */
import { pool } from "@workspace/db";
import { AppError } from "./http";
import { SETUP_CODES, type SetupCode } from "./setupClassifier";
import { ruSetups } from "./setupsI18n";
import { codeFromName } from "./playbookToday/build";

export type OfficeSetup = { id: number; code: string | null; name: string; folder: string | null; minTier: string | null };
export type SetupLink = { playbookId: number | null; setup: string | null };

/** lib/playbookAccess spaceSql («office» = space office, or a setup without an owner), inlined: this module is imported
 *  by routes/trades, whose tests fake playbookAccess. */
const SPACE = `COALESCE(p.space, CASE WHEN p.trader IS NULL THEN 'office' ELSE 'personal' END)`;

let cache: { at: number; rows: Promise<OfficeSetup[]> } | null = null;
const TTL_MS = 60_000;

/** The office setups, by code then name. */
export function loadOfficeSetups(): Promise<OfficeSetup[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const rows = pool
    .query<{ id: number; name: string; folder: string | null; min_tier: string | null }>(
      `SELECT p.id, p.name, p.folder, p.min_tier FROM playbook p
        WHERE p.deleted_at IS NULL AND ${SPACE} = 'office' AND p.parent_id IS NULL
        ORDER BY p.name`,
    )
    .then((r) => r.rows.map((x) => ({ id: Number(x.id), code: codeFromName(x.name), name: String(x.name), folder: x.folder ?? null, minTier: x.min_tier ?? null })))
    .catch((err) => { cache = null; throw err; });
  cache = { at: Date.now(), rows };
  return rows;
}

/** Tests / after a playbook edit. */
export function forgetOfficeSetups(): void {
  cache = null;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** The office setup a free text names: the exact name, or its number («1.3», «1.3 что угодно»). */
export function matchOfficeSetup(text: string | null | undefined, setups: readonly OfficeSetup[]): OfficeSetup | null {
  if (!text || !text.trim()) return null;
  const n = norm(text);
  const byName = setups.find((s) => norm(s.name) === n);
  if (byName) return byName;
  const code = codeFromName(text) ?? (/^\d{1,2}\.\d{1,2}$/.test(n) ? n : null);
  return code ? setups.find((s) => s.code === code) ?? null : null;
}

/**
 * Auto-classifier class → office setup number. Time-of-day / holding classes (midday, scalp, swing…) describe WHEN,
 * not a pattern: no setup, the suggestion stays a hint and accepting it writes no playbook link.
 */
export const CLASS_TO_OFFICE: Readonly<Record<SetupCode, string | null>> = {
  gapGo: "1.1", pmh: "1.1", pml: "1.1",
  openMomentum: "1.2",
  orb: "1.3",
  vwapBounce: "2.1",
  hod: "2.3", lod: "2.3",
  vwapReversion: "3.1",
  longLow: "3.2",
  shortHigh: "3.3",
  gapFade: "4.2",
  powerHour: "5.1",
  close: "5.2",
  midday: null, morning: null, premarket: null, after: null, scalp: null, overnight: null, swing: null, noTime: null,
};

const CODE_BY_CLASS_NAME = new Map<string, SetupCode>(SETUP_CODES.map((c) => [ruSetups.classes[c], c]));

/** Office setup number for a classifier class (its stored canonical name, or the code itself). */
export function officeCodeForClass(cls: string | null | undefined): string | null {
  if (!cls) return null;
  const code = CODE_BY_CLASS_NAME.get(cls) ?? ((SETUP_CODES as readonly string[]).includes(cls) ? (cls as SetupCode) : null);
  return code ? CLASS_TO_OFFICE[code] : null;
}

/** The office setup a classifier class maps to (null: a time-only class, or the setup is not in the office). */
export function officeSetupForClass(cls: string | null | undefined, setups: readonly OfficeSetup[]): OfficeSetup | null {
  const code = officeCodeForClass(cls);
  return code ? setups.find((s) => s.code === code) ?? null : null;
}

/**
 * What a write stores. `playbookId` wins: an office setup, or a personal setup of the trade's owner (`owner`), else
 * SETUP_NOT_FOUND; `null` clears both. Otherwise `setup` text: an office setup's name / number links it, `null` / ""
 * clears both, any other text is kept as text with no link (a legacy free-text setup never keeps a stale link).
 */
export async function resolveSetupLink(input: { playbookId?: unknown; setup?: unknown }, owner: string | null): Promise<SetupLink> {
  if (input.playbookId !== undefined) {
    if (input.playbookId === null || input.playbookId === "") return { playbookId: null, setup: null };
    const id = Number(input.playbookId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new AppError("INVALID_FIELD", undefined, { field: "playbookId" });
    const { rows } = await pool.query<{ id: number; name: string; trader: string | null; space: string }>(
      `SELECT p.id, p.name, p.trader, ${SPACE} AS space FROM playbook p WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [id],
    );
    const row = rows[0];
    if (!row || (row.space !== "office" && (!owner || row.trader !== owner))) throw new AppError("SETUP_NOT_FOUND");
    return { playbookId: Number(row.id), setup: String(row.name) };
  }
  const text = typeof input.setup === "string" ? input.setup.trim() : null;
  if (!text) return { playbookId: null, setup: null };
  const hit = matchOfficeSetup(text, await loadOfficeSetups());
  return hit ? { playbookId: hit.id, setup: hit.name } : { playbookId: null, setup: text };
}

/** A trade's setup link changed: «Без сетапа», «Сегодня» and the tag_yesterday quest re-read (best effort). */
export async function setupTagged(tradeId: number): Promise<void> {
  try {
    const { tradeTagged } = await import("./playbookToday/service");
    await tradeTagged(tradeId);
  } catch { /* the caches expire on their own */ }
}

/** Does a write body touch the setup tag? (`setup` or `playbookId` present.) */
export function touchesSetup(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  return Object.prototype.hasOwnProperty.call(body, "setup") || Object.prototype.hasOwnProperty.call(body, "playbookId");
}
