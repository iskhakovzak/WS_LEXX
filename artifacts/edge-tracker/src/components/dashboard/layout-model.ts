/**
 * The dashboard layout (owner, 2026-10-25: «убирать плитки, возвращать, менять местами и размер прямо на дашборде»):
 * which tiles are shown, in which order and at which size. Pure data + operations; packing lives in ./pack, the edit
 * mode in ./board, persistence in ./dashboard-layout.
 *
 * - A tile belongs to one section of the page («План на день», «Ваш edge», «Сделки», «Дополнительно») and moves only
 *   inside it; «Сегодня» (the hero) is fixed above them and is not a tile.
 * - `items` = the visible tiles in order; a tile that is not listed is hidden (offered in the «Добавить» gallery).
 * - Each tile declares its sizes (S / M / L / XL = 4 / 6 / 8 / 12 of 12 columns) and the sizes that may span 2 rows.
 * - Staff-only tiles stay in a trader's layout but never render or show in the gallery; «Мои»-only tiles (the edge)
 *   stay in the layout and simply hide on «Команда».
 * Stored as users.settings.dashboardLayout (API lib/people/dashboardLayoutSchema mirrors the schema below).
 */
import { z } from "zod";
import type { SectionId } from "./use-dashboard";

export type BoardSection = "plan" | "edge" | "trades" | "extras";
export const BOARD_SECTIONS: readonly BoardSection[] = ["plan", "edge", "trades", "extras"];

export type TileSize = "s" | "m" | "l" | "xl";
export const TILE_SIZES: readonly TileSize[] = ["s", "m", "l", "xl"];
/** Columns of the 12-column grid per size. */
export const SIZE_SPAN: Record<TileSize, number> = { s: 4, m: 6, l: 8, xl: 12 };
/** What a tile shows at its packed width: compact = number + verdict, medium = + a mini chart, large = full detail. */
export type TileVariant = "s" | "m" | "l";

export type TileSpec = {
  section: BoardSection;
  sizes: readonly TileSize[];
  /** Sizes that may span two rows. */
  tall?: readonly TileSize[];
  /** Default size and rows. */
  size: TileSize;
  rows?: 1 | 2;
  /** Shown by default (otherwise offered in the gallery). */
  on: boolean;
  staffOnly?: boolean;
  /** Own trades only: hidden (not removed) on «Команда». */
  meOnly?: boolean;
  /** Renders only when it has something (open positions, the risk desk): a placeholder in the edit mode. */
  conditional?: boolean;
};

const ALL: readonly TileSize[] = TILE_SIZES;
const INSIGHT: readonly TileSize[] = ["s", "m", "l"];

/** In the default order: the composed dashboard of 2026-10-25, packed without holes (see pack.test fixtures). */
export const TILE_SPECS: Record<SectionId, TileSpec> = {
  attention: { section: "plan", sizes: ALL, size: "s", on: true },
  equity: { section: "plan", sizes: ALL, size: "m", on: true },
  leaks: { section: "edge", sizes: ALL, tall: ["m", "l"], size: "l", rows: 2, on: true, meOnly: true },
  streaks: { section: "edge", sizes: ALL, tall: ["s", "m"], size: "s", on: true, meOnly: true },
  seqDay: { section: "edge", sizes: INSIGHT, tall: ["s", "m"], size: "s", on: true, meOnly: true },
  afterLoss: { section: "edge", sizes: INSIGHT, tall: ["s", "m"], size: "s", on: true, meOnly: true },
  holdTime: { section: "edge", sizes: INSIGHT, tall: ["s", "m"], size: "s", on: true, meOnly: true },
  fees: { section: "edge", sizes: INSIGHT, tall: ["s", "m"], size: "s", on: true, meOnly: true },
  weekdays: { section: "edge", sizes: INSIGHT, tall: ["s", "m"], size: "m", on: false, meOnly: true },
  positions: { section: "trades", sizes: ["xl"], size: "xl", on: true, conditional: true },
  recent: { section: "trades", sizes: ALL, size: "m", on: true },
  // The desk table needs half a row at least (trader · day · week · limit).
  desk: { section: "trades", sizes: ["m", "l", "xl"], size: "m", on: true, staffOnly: true, conditional: true },
  checkin: { section: "extras", sizes: ["m", "l", "xl"], size: "m", on: true },
  brief: { section: "extras", sizes: ["m", "l", "xl"], size: "xl", on: false },
  sectors: { section: "extras", sizes: ["m", "l", "xl"], size: "m", on: false },
  macro: { section: "extras", sizes: INSIGHT, size: "s", on: false },
  dna: { section: "extras", sizes: INSIGHT, size: "s", on: false },
  quote: { section: "extras", sizes: INSIGHT, size: "s", on: false },
  psychology: { section: "extras", sizes: ["m", "l", "xl"], size: "xl", on: false },
};

export const TILE_ORDER = Object.keys(TILE_SPECS) as SectionId[];
const KNOWN = new Set<string>(TILE_ORDER);

export type LayoutItem = { id: SectionId; size: TileSize; rows?: 2 };
export type DashLayout = { v: 1; items: LayoutItem[] };

/** The stored block (users.settings.dashboardLayout). Ids stay strings so an older client never rejects a newer tile. */
export const StoredLayoutSchema = z.object({
  v: z.literal(1),
  items: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/),
    size: z.enum(["s", "m", "l", "xl"]),
    rows: z.literal(2).optional(),
  })).max(48),
  updatedAt: z.string().max(40).optional(),
});
export type StoredLayout = z.infer<typeof StoredLayoutSchema>;

export const isTall = (it: Pick<LayoutItem, "rows">) => it.rows === 2;
export const canBeTall = (id: SectionId, size: TileSize) => !!TILE_SPECS[id].tall?.includes(size);

function itemOf(id: SectionId, size?: string, rows?: number): LayoutItem {
  const spec = TILE_SPECS[id];
  const s = spec.sizes.includes(size as TileSize) ? (size as TileSize) : spec.size;
  const tall = (size === undefined ? spec.rows === 2 : rows === 2) && canBeTall(id, s);
  return tall ? { id, size: s, rows: 2 } : { id, size: s };
}

/** Keep the sections in page order (a tile only ever moves inside its own section). */
function bySection(items: LayoutItem[]): LayoutItem[] {
  return BOARD_SECTIONS.flatMap((s) => items.filter((it) => TILE_SPECS[it.id].section === s));
}

export function defaultLayout(): DashLayout {
  return { v: 1, items: TILE_ORDER.filter((id) => TILE_SPECS[id].on).map((id) => itemOf(id)) };
}

/** Anything stored → a valid layout: unknown ids dropped, sizes clamped to the tile's own, duplicates removed. */
export function sanitizeLayout(raw: unknown): DashLayout | null {
  const parsed = StoredLayoutSchema.safeParse(raw);
  if (!parsed.success) return null;
  const seen = new Set<string>();
  const items: LayoutItem[] = [];
  for (const it of parsed.data.items) {
    if (!KNOWN.has(it.id) || seen.has(it.id)) continue;
    seen.add(it.id);
    items.push(itemOf(it.id as SectionId, it.size, it.rows));
  }
  return { v: 1, items: bySection(items) };
}

/**
 * The v6 prefs (order + hidden ids, localStorage, 2026-10-25) → the layout, once: the viewer's order and shown tiles
 * at their default sizes. v6 «Команда» defaults hid the own tiles — those come back (they hide on «Команда» by
 * themselves now). Unreadable → null (the default layout).
 */
export function layoutFromV6(raw: unknown): DashLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { order?: unknown; hidden?: unknown; scope?: unknown };
  if (!Array.isArray(r.order) || !Array.isArray(r.hidden)) return null;
  const hidden = new Set(r.hidden.filter((x): x is string => typeof x === "string"));
  const order = r.order.filter((x): x is SectionId => typeof x === "string" && KNOWN.has(x));
  for (const id of TILE_ORDER) if (!order.includes(id)) order.push(id);
  const teamDefault = r.scope === "team";
  const shown = Array.from(new Set(order)).filter((id) => {
    const spec = TILE_SPECS[id];
    if (teamDefault && spec.meOnly) return spec.on;
    return !hidden.has(id);
  });
  return { v: 1, items: bySection(shown.map((id) => itemOf(id))) };
}

export const sectionOf = (id: SectionId) => TILE_SPECS[id].section;
export const sectionItems = (l: DashLayout, s: BoardSection) => l.items.filter((it) => TILE_SPECS[it.id].section === s);

/** Move a tile to `to` (index among its section's tiles). */
export function moveItem(l: DashLayout, id: SectionId, to: number): DashLayout {
  const s = sectionOf(id);
  const list = sectionItems(l, s);
  const from = list.findIndex((it) => it.id === id);
  if (from < 0) return l;
  const clamped = Math.max(0, Math.min(list.length - 1, to));
  if (clamped === from) return l;
  const next = [...list];
  const [it] = next.splice(from, 1);
  next.splice(clamped, 0, it);
  return { ...l, items: bySection([...l.items.filter((x) => sectionOf(x.id) !== s), ...next]) };
}

/** Move a tile to the place of another one of the same section (drag over a tile). */
export function moveOnto(l: DashLayout, id: SectionId, target: SectionId): DashLayout {
  if (id === target || sectionOf(id) !== sectionOf(target)) return l;
  return moveItem(l, id, sectionItems(l, sectionOf(id)).findIndex((it) => it.id === target));
}

export function resizeItem(l: DashLayout, id: SectionId, size: TileSize, rows?: 1 | 2): DashLayout {
  return { ...l, items: l.items.map((it) => (it.id === id ? itemOf(id, size, rows ?? it.rows ?? 1) : it)) };
}

/** Removes a tile; `undo` puts it back where it was, at its size. */
export function removeItem(l: DashLayout, id: SectionId): { layout: DashLayout; undo: (cur: DashLayout) => DashLayout } {
  const s = sectionOf(id);
  const idx = sectionItems(l, s).findIndex((it) => it.id === id);
  const item = l.items.find((it) => it.id === id);
  if (!item) return { layout: l, undo: (cur) => cur };
  return {
    layout: { ...l, items: l.items.filter((it) => it.id !== id) },
    undo: (cur) => addItem(cur, id, { index: idx, size: item.size, rows: item.rows ?? 1 }),
  };
}

/** Shows a hidden tile in its section (at `index`, default: the end) at its default size. */
export function addItem(l: DashLayout, id: SectionId, opts: { index?: number; size?: TileSize; rows?: 1 | 2 } = {}): DashLayout {
  if (l.items.some((it) => it.id === id)) return l;
  const s = sectionOf(id);
  const list = sectionItems(l, s);
  const at = opts.index == null ? list.length : Math.max(0, Math.min(list.length, opts.index));
  const item = opts.size ? itemOf(id, opts.size, opts.rows ?? 1) : itemOf(id);
  const next = [...list.slice(0, at), item, ...list.slice(at)];
  return { ...l, items: bySection([...l.items.filter((x) => sectionOf(x.id) !== s), ...next]) };
}

/** The next / previous allowed size (+ / − keys). Growing past the widest one-row size makes an allowed size tall. */
export function stepSize(it: LayoutItem, dir: 1 | -1): { size: TileSize; rows: 1 | 2 } | null {
  const steps: { size: TileSize; rows: 1 | 2 }[] = [];
  for (const size of TILE_SPECS[it.id].sizes) {
    steps.push({ size, rows: 1 });
    if (canBeTall(it.id, size)) steps.push({ size, rows: 2 });
  }
  const cur = steps.findIndex((x) => x.size === it.size && x.rows === (it.rows ?? 1));
  const next = steps[cur + dir];
  return next ?? null;
}

/** The content layout for a packed width: compact up to ~5/12, medium up to ~7/12, large from 8/12; phones follow the chosen size. */
export function variantFor(it: Pick<LayoutItem, "size">, span: number, rows: number, cols: number): TileVariant {
  let v: TileVariant;
  if (cols <= 1) v = it.size === "s" ? "s" : it.size === "m" ? "m" : "l";
  else {
    const f = span / cols;
    v = f < 0.45 ? "s" : f < 0.64 ? "m" : "l";
  }
  // A tall compact tile has the height for its chart.
  return v === "s" && rows > 1 && cols > 1 ? "m" : v;
}

export function sameLayout(a: DashLayout, b: DashLayout): boolean {
  return a.items.length === b.items.length && a.items.every((it, i) => it.id === b.items[i].id && it.size === b.items[i].size && (it.rows ?? 1) === (b.items[i].rows ?? 1));
}
