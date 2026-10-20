/**
 * Who sees which menu — pure model over nav.ts (unit-tested in nav-model.test.ts).
 *
 * - `visibleNav(isCurator)`: the full menu for a role (staff-only pages filtered, hidden ones dropped). The command
 *   palette always searches it, so every page stays reachable whatever the sidebar shows.
 * - Simple menu (owner UX law «fewer choices», keep new traders): a trader whose tier (GET /api/permissions/me → tier,
 *   the ladder stage of lib/people/stage — «Джун» by default) is Джун or below gets the primary rows — Сегодня, План
 *   дня, Плейбук, Тренажёр, Моё обучение, Дневник, Сделки, Мой прогресс — and everything else in one collapsed «Ещё»
 *   group. Nothing is removed: every page of the full menu is in the primary rows or in «Ещё». Staff, guests and the
 *   experienced tiers (Трейдер, Сеньор) keep the full menu. Волна 1, item 1.11: the ladder has no «Стажёр» any more, so
 *   the desk setting nav.simpleUntilTier never goes below «junior» (an old «trainee» value means «newcomers» = juniors);
 *   a trader without a resolved tier counts as a junior (the stage default).
 * - Phone tab bar for juniors (item 1.3): Дашборд · План · Дневник (labelled «Вечер») · Сделки · Ещё.
 */
import { shellI18n } from "@/i18n/ns/shell";
import { NAV_GROUPS, type NavGroup, type NavItem } from "./nav";

export type VisibleGroup = Omit<NavGroup, "items"> & {
  /** Sidebar rows with only the children this viewer may open. */
  rows: NavItem[];
  /** Every visible page of the group, flat (rows and their children) — the phone «More» sheet. */
  items: NavItem[];
};

/** Copy of an item that keeps its label getters (spreading would freeze them in one language). */
export function withGetters(i: NavItem): NavItem {
  return Object.create(Object.getPrototypeOf(i), Object.getOwnPropertyDescriptors(i));
}

/** Full nav for the role (staff-only pages filtered, hidden ones dropped). */
export function visibleNav(isCurator: boolean): VisibleGroup[] {
  const ok = (i: NavItem) => !i.hidden && (!i.staff || isCurator);
  return NAV_GROUPS.map((g) => {
    const rows = g.items.filter(ok).map((r) => {
      if (!r.children) return r;
      const copy = withGetters(r);
      copy.children = r.children.filter(ok);
      return copy;
    });
    return { id: g.id, get label() { return g.label; }, rows, items: rows.flatMap((r) => [r, ...(r.children ?? [])]) };
  }).filter((g) => g.rows.length);
}

// ─── Simple menu ──────────────────────────────────────────────────────────────

/** Ladder tiers, low → high (api lib/playbookToday/build TIER_KEYS). */
export const TIERS = ["trainee", "junior", "trader", "senior", "lead"] as const;
export type Tier = (typeof TIERS)[number];
const rank = (t: Tier) => TIERS.indexOf(t);
const isTier = (v: unknown): v is Tier => typeof v === "string" && (TIERS as readonly string[]).includes(v);

/** Desk settings `nav.*` as GET /api/permissions/me sends them. */
export type NavPrefs = { simpleForTrainees: boolean; simpleUntilTier: "trainee" | "junior" };
export const DEFAULT_NAV_PREFS: NavPrefs = { simpleForTrainees: true, simpleUntilTier: "junior" };

/**
 * The highest tier that still gets the simple menu. Both values of nav.simpleUntilTier mean «newcomers» now: the
 * ladder starts at Джун (item 1.11), so the old «trainee» (= the lowest tier) and «junior» both end at Джун.
 */
const SIMPLE_UNTIL: Tier = "junior";

/**
 * Simple menu for this viewer? Only traders; a trader without a resolved tier counts as a junior (the stage default,
 * lib/people/stage DEFAULT_STAGE). Staff, guests, the desk setting off and tiers above Джун → full menu.
 */
export function isSimpleNav(v: { role: string | null | undefined; tier: string | null | undefined; prefs?: Partial<NavPrefs> | null }): boolean {
  if (v.role !== "trader") return false;
  const prefs = { ...DEFAULT_NAV_PREFS, ...(v.prefs ?? {}) };
  if (!prefs.simpleForTrainees) return false;
  return rank(isTier(v.tier) ? v.tier : "junior") <= rank(SIMPLE_UNTIL);
}

/** Primary rows of the simple menu, in order. `/ratings` opens on the quests tab as «Мой прогресс». */
export const SIMPLE_PRIMARY = ["/", "/game-plan", "/playbook", "/trainer", "/academy/my", "/journal", "/trades", "/ratings"] as const;
/** Phone tab bar in the simple menu (the 5th slot is «Ещё»): the day's loop — morning plan, evening journal, trades. */
export const SIMPLE_MOBILE_TABS = ["/", "/game-plan", "/journal", "/trades"] as const;
/** Phone tab bar in the full menu. */
export const MOBILE_TABS = ["/", "/game-plan", "/trades", "/journal"] as const;

export type SimpleNav = {
  /** Seven primary rows (labels adapted: «Сегодня», «Мой прогресс»). */
  primary: NavItem[];
  /** Rows of the «Ещё» group (full-menu order, primary pages taken out). */
  more: NavItem[];
  /** Every page of «Ещё», flat (rows and their children) — the phone sheet. */
  moreItems: NavItem[];
  /** The tier from which the full menu opens (the one-line hint at the top of «Ещё»). */
  opensAt: Tier;
};

function relabel(i: NavItem, label: () => string, extra: Partial<NavItem> = {}): NavItem {
  const copy = withGetters(i);
  Object.defineProperty(copy, "name", { get: label, enumerable: true, configurable: true });
  Object.defineProperty(copy, "short", { get: label, enumerable: true, configurable: true });
  return Object.assign(copy, extra);
}

/** Split the full menu into the primary rows and the «Ещё» group (`_prefs`: kept for callers; the floor is fixed). */
export function simpleNav(groups: VisibleGroup[], _prefs?: Partial<NavPrefs> | null): SimpleNav {
  const primarySet = new Set<string>(SIMPLE_PRIMARY);
  const all = groups.flatMap((g) => g.items);
  const primary = SIMPLE_PRIMARY.flatMap((href) => {
    const i = all.find((x) => x.href === href);
    if (!i) return [];
    // «Квесты и достижения» = that ratings tab, named exactly like it; the ratings' own pages (Бенчмарк, Топ, Офис) go to «Ещё».
    if (href === "/ratings") return [relabel(i, () => shellI18n.t("simple.progress"), { to: "/ratings?tab=quests", children: undefined })];
    // A page that is a child in the full menu (Тренажёр under «Инструменты») becomes a row of its own.
    return [withGetters(i)];
  });
  const more: NavItem[] = [];
  for (const row of groups.flatMap((g) => g.rows)) {
    if (row.href === "/ratings") { more.push(...(row.children ?? []).map((c) => withGetters(c))); continue; }
    if (primarySet.has(row.href)) continue;
    const kids = row.children?.filter((c) => !primarySet.has(c.href));
    if (row.children && kids && kids.length !== row.children.length) {
      const copy = withGetters(row);
      copy.children = kids;
      more.push(copy);
    } else more.push(row);
  }
  const until = SIMPLE_UNTIL;
  return {
    primary,
    more,
    moreItems: more.flatMap((r) => [r, ...(r.children ?? [])]),
    opensAt: TIERS[rank(until) + 1]!,
  };
}

/**
 * ILYA-18: the phone sheet lists the same pages as the desktop sidebar — a primary row AND its children (Журнал →
 * Разбор дня, Отчёт недели; Академия → Путь трейдера, Экзамены), flat, in sidebar order.
 */
export function sheetPrimaryItems(simple: Pick<SimpleNav, "primary">): NavItem[] {
  const seen = new Set<string>();
  const out: NavItem[] = [];
  for (const r of simple.primary) for (const i of [r, ...(r.children ?? [])]) if (!seen.has(i.href)) { seen.add(i.href); out.push(i); }
  return out;
}

/** OWNER-28: a pinned page is listed once — in «Избранное», not again in its group. */
export function withoutPinned<T extends { href: string }>(items: readonly T[], pins: readonly string[]): T[] {
  if (!pins.length) return [...items];
  const p = new Set(pins);
  return items.filter((i) => !p.has(i.href));
}

/**
 * OWNER-28 (desktop): a set's children. Open → all of them in the list. Closed → the pinned ones stay visible under the
 * row and the folded list keeps only the others, so a pinned page is never in the DOM twice (two «Открепить»).
 */
export function rowKidLists<T extends { href: string }>(kids: readonly T[], open: boolean, isPinned: (href: string) => boolean): { list: T[]; pinned: T[] } {
  if (open) return { list: [...kids], pinned: [] };
  return { list: kids.filter((k) => !isPinned(k.href)), pinned: kids.filter((k) => isPinned(k.href)) };
}

/** A copy with another phone-tab label (the sidebar keeps the page's own name). */
function withShort(i: NavItem, label: () => string): NavItem {
  const copy = withGetters(i);
  Object.defineProperty(copy, "short", { get: label, enumerable: true, configurable: true });
  return copy;
}

/** The phone tab bar: four sections (the 5th slot is «Ещё»). Juniors see the journal as «Вечер» (the evening step). */
export function mobileTabs(groups: VisibleGroup[], simple: SimpleNav | null): NavItem[] {
  if (simple) {
    return SIMPLE_MOBILE_TABS.flatMap((h) => {
      const i = simple.primary.find((x) => x.href === h);
      if (!i) return [];
      return [h === "/journal" ? withShort(i, () => shellI18n.t("simple.evening")) : i];
    });
  }
  const all = groups.flatMap((g) => g.items);
  return MOBILE_TABS.flatMap((h) => all.find((i) => i.href === h) ?? []);
}
