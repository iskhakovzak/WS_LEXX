/**
 * «Доступ по ступеням» — pure model of the admin table (unit-tested in stage-access-model.test.ts). The data are two desk
 * settings (GET/PUT /api/admin/settings, server lib/settings/registry.ts):
 *   access.sections          section href → stages it is CLOSED for ({} = everything open, the default)
 *   privacy.namesVisibleTo   stages that see other traders' real names; never saved → the legacy switch
 *                            privacy.hideNamesFromTraders decides (on → nobody, off → every stage), like the server.
 * The table shows switches «on = open»; the draft keeps the stored shape. Staff are never restricted (server rule).
 */
import type { AnySettingRow, AnyValue, SectionStages, StageKey, StageList } from "./desk-settings-model";

export const STAGES: readonly StageKey[] = ["junior", "trader", "senior"];
export const SECTIONS_KEY = "access.sections";
export const NAMES_KEY = "privacy.namesVisibleTo";
export const LEGACY_NAMES_KEY = "privacy.hideNamesFromTraders";

export type AccessDraft = { sections: SectionStages; names: StageList };

/** Rows of the table as the page passes them (built from the sidebar, components/shell/nav-model blockableSections). */
export type AccessSection = { href: string; readonly label: string; parent: string | null };
export type AccessGroup = { id: string; readonly label: string; sections: AccessSection[] };

const isStage = (v: unknown): v is StageKey => v === "junior" || v === "trader" || v === "senior";
const ladder = (list: Iterable<unknown>): StageKey[] => { const s = new Set(list); return STAGES.filter((x) => s.has(x)); };

/** A section map in its stored form: sorted hrefs, stage lists in ladder order, empty lists dropped. */
export function normalizeSections(map: unknown): SectionStages {
  if (!map || typeof map !== "object" || Array.isArray(map)) return {};
  const out: Record<string, StageList> = {};
  for (const href of Object.keys(map).sort()) {
    const list = (map as Record<string, unknown>)[href];
    const stages = Array.isArray(list) ? ladder(list.filter(isStage)) : [];
    if (stages.length) out[href] = stages;
  }
  return out;
}

const rowOf = (rows: readonly AnySettingRow[], key: string) => rows.find((r) => r.key === key);

/** Names list in force: the saved list, else the legacy switch's meaning (same rule as the server). */
export function namesInForce(rows: readonly AnySettingRow[]): StageList {
  const names = rowOf(rows, NAMES_KEY);
  if (names && Array.isArray(names.value)) return ladder(names.value);
  const legacy = rowOf(rows, LEGACY_NAMES_KEY);
  const hide = legacy ? legacy.effective !== false : true;
  return hide ? [] : [...STAGES];
}

/** What is in force now, as the draft starts. */
export function readAccess(rows: readonly AnySettingRow[]): AccessDraft {
  return { sections: normalizeSections(rowOf(rows, SECTIONS_KEY)?.effective), names: namesInForce(rows) };
}

/** Is `href` open for `stage` in the draft? */
export function isOpen(d: AccessDraft, href: string, stage: StageKey): boolean {
  return !(d.sections[href] ?? []).includes(stage);
}

/** Switch one cell: open (true) or closed (false). */
export function setOpen(d: AccessDraft, href: string, stage: StageKey, open: boolean): AccessDraft {
  const cur = new Set(d.sections[href] ?? []);
  if (open) cur.delete(stage); else cur.add(stage);
  return { ...d, sections: normalizeSections({ ...d.sections, [href]: [...cur] }) };
}

/** Switch a whole column for one section row at once (every stage open / closed). */
export function setRowOpen(d: AccessDraft, href: string, open: boolean): AccessDraft {
  return { ...d, sections: normalizeSections({ ...d.sections, [href]: open ? [] : [...STAGES] }) };
}

/** Does `stage` see other traders' names in the draft? */
export function seesNames(d: AccessDraft, stage: StageKey): boolean {
  return d.names.includes(stage);
}

export function setNames(d: AccessDraft, stage: StageKey, on: boolean): AccessDraft {
  const cur = new Set(d.names);
  if (on) cur.add(stage); else cur.delete(stage);
  return { ...d, names: ladder(cur) };
}

/** «Открыть всё»: every section open for every stage (names unchanged — that is a privacy choice of its own). */
export function openAll(d: AccessDraft): AccessDraft {
  return { ...d, sections: {} };
}

/** Closed cells in the draft (the summary pill). */
export function closedCount(d: AccessDraft): number {
  return Object.values(d.sections).reduce((n, l) => n + l.length, 0);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The PUT batch for the draft: only what differs from what is in force. Sections back to {} are sent as null («по
 * умолчанию»); the names list is always sent as a list (it becomes the saved rule and the legacy switch stops counting).
 */
export function accessChanges(rows: readonly AnySettingRow[], d: AccessDraft): { key: string; value: AnyValue | null }[] {
  const now = readAccess(rows);
  const out: { key: string; value: AnyValue | null }[] = [];
  const sections = normalizeSections(d.sections);
  if (!same(sections, now.sections)) out.push({ key: SECTIONS_KEY, value: Object.keys(sections).length ? sections : null });
  if (!same(ladder(d.names), now.names)) out.push({ key: NAMES_KEY, value: ladder(d.names) });
  return out;
}

/** Hrefs closed in the draft that the table has no row for (an old section): kept, listed under the table. */
export function unknownClosed(d: AccessDraft, groups: readonly AccessGroup[]): string[] {
  const known = new Set(groups.flatMap((g) => g.sections.map((s) => s.href)));
  return Object.keys(d.sections).filter((h) => !known.has(h));
}
