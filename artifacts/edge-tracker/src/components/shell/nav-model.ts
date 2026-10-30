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
 * - Phone dock (mobile wave): Главная · Сделки · Дневник · Аналитика · Риск · Ещё for everyone (juniors see the journal
 *   as «Вечер», the evening step of the day); «План дня» heads the juniors' sheet. The sheet lists the rest of the
 *   sidebar in the same groups, «Закреплённые» first (`pinnedNavItems`).
 * - Sections closed for the viewer's ladder stage (desk setting access.sections → GET /api/permissions/me nav.blocked;
 *   staff never): gone from the sidebar, the phone sheet, the palette and pinned items (`navItemOpen`); a closed row's
 *   open pages move up as rows of their own. The route guard (App.tsx) shows «Раздел закрыт» for a closed URL
 *   (`blockedSectionOf`); the admin table lists `blockableSections()`.
 */
import { shellI18n } from "@/i18n/ns/shell";
import { blockedSections } from "@/lib/permissions";
import { ALL_NAV_ITEMS, NAV_GROUPS, isNavActive, type NavFeature, type NavGroup, type NavItem } from "./nav";

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

/** A section behind a desk switch is shown only when GET /api/permissions/me → `nav.<feature>` is true. */
export function navFeatureOn(feature: NavFeature | undefined, nav: unknown): boolean {
  if (!feature) return true;
  return !!nav && typeof nav === "object" && (nav as Record<string, unknown>)[feature] === true;
}

/**
 * May this viewer open the page at all (staff-only, desk switch, closed for the stage)? Hidden pages stay openable —
 * the sidebar drops them separately. Used by the menu, the palette and pinned items alike.
 */
export function navItemOpen(i: NavItem, isCurator: boolean, nav: unknown): boolean {
  return (!i.staff || isCurator) && navFeatureOn(i.feature, nav) && !blockedSections(nav).includes(i.href);
}

/**
 * Full nav for the role (staff-only pages filtered, hidden ones, switched-off and closed sections dropped). No
 * single-item sub-menus: a row left with one visible child (role, desk switch, closed section) lists that child as a
 * row of its own right below it, so a chevron never opens a list of one.
 */
export function visibleNav(isCurator: boolean, nav?: unknown): VisibleGroup[] {
  const closed = new Set(blockedSections(nav));
  const ok = (i: NavItem) => !i.hidden && navItemOpen(i, isCurator, nav);
  // A row closed for the stage: its own page goes, its open children become rows (blocking «Рейтинг» keeps «Бенчмарк»).
  const base = (i: NavItem) => !i.hidden && (!i.staff || isCurator) && navFeatureOn(i.feature, nav);
  return NAV_GROUPS.map((g) => {
    const rows = g.items.filter(base).flatMap((r): NavItem[] => {
      if (closed.has(r.href)) return (r.children ?? []).filter(ok);
      if (!r.children) return [r];
      const copy = withGetters(r);
      const kids = r.children.filter(ok);
      copy.children = kids.length > 1 ? kids : undefined;
      return kids.length === 1 ? [copy, kids[0]!] : [copy];
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
/**
 * Phone bottom dock (below 768 px): the five main screens, the same for every menu — Главная, Сделки, Дневник,
 * Аналитика, Риск — then «Ещё» (the sheet with the rest of the sidebar). A screen the viewer cannot open (closed for the
 * stage, staff-only) is left out and stays reachable through «Ещё» / the palette; the dock never shows a dead tab.
 */
export const MOBILE_TABS = ["/", "/trades", "/journal", "/analytics", "/risk"] as const;

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
    // A page that would be a child in the full menu becomes a row of its own here.
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
 * «Закреплённые» (top of the sidebar and of the phone sheet): the pinned pages this viewer may open, in pin order. A
 * staff-only page pinned while signed in as curator never shows for a trader, nor a section closed for the stage or
 * a hidden one. Each pinned page is listed there only (`withoutPinned` takes it out of its row / group).
 */
export function pinnedNavItems(pins: readonly string[], isCurator: boolean, nav: unknown): NavItem[] {
  return pins
    .map((h) => ALL_NAV_ITEMS.find((i) => i.href === h))
    .filter((i): i is NavItem => !!i && !i.hidden && navItemOpen(i, isCurator, nav));
}

/** A copy with another phone-tab label (the sidebar keeps the page's own name). */
function withShort(i: NavItem, label: () => string): NavItem {
  const copy = withGetters(i);
  Object.defineProperty(copy, "short", { get: label, enumerable: true, configurable: true });
  return copy;
}

/**
 * The phone dock: up to five main screens (the 6th slot is «Ещё»), in MOBILE_TABS order, only those this viewer may
 * open (`groups` is already filtered by role, desk switches and stage-closed sections). The home tab is labelled
 * «Главная»; juniors see the journal as «Вечер» (the evening step).
 */
export function mobileTabs(groups: VisibleGroup[], simple: SimpleNav | null): NavItem[] {
  const all = groups.flatMap((g) => g.items);
  return MOBILE_TABS.flatMap((h) => {
    const i = all.find((x) => x.href === h);
    if (!i) return [];
    if (h === "/") return [withShort(i, () => shellI18n.t("mobile.home"))];
    if (h === "/journal" && simple) return [withShort(i, () => shellI18n.t("simple.evening"))];
    return [i];
  });
}

/**
 * The phone sheet behind «Ещё» lists the rest of the sidebar: the dock's own screens are taken out (their children —
 * Статистика, Поведение… — stay). Label getters survive (the copy keeps property descriptors).
 */
export function withoutDock(groups: VisibleGroup[], dock: readonly string[]): VisibleGroup[] {
  if (!dock.length) return groups;
  const drop = new Set(dock);
  return groups
    .map((g) => {
      const copy = Object.create(Object.getPrototypeOf(g), Object.getOwnPropertyDescriptors(g)) as VisibleGroup;
      copy.items = g.items.filter((i) => !drop.has(i.href));
      return copy;
    })
    .filter((g) => g.items.length);
}

/**
 * Simple menu in the sheet: the dock's screens out of «Главное» (a dock row's children — Разбор дня, Отчёт недели under
 * the journal — move up as rows of their own) and out of the folded «Ещё» list.
 */
export function simpleWithoutDock(simple: SimpleNav, dock: readonly string[]): SimpleNav {
  const drop = new Set(dock);
  const primary = simple.primary.flatMap((r) => (drop.has(r.href) ? (r.children ?? []).filter((c) => !drop.has(c.href)) : [r]));
  return { ...simple, primary, moreItems: simple.moreItems.filter((i) => !drop.has(i.href)) };
}

// ─── Sections closed per stage ───────────────────────────────────────────────

/**
 * The closed section a URL belongs to (its href), or null: the page itself, anything under it, and its `also` paths
 * (/error-tracker for «Правила», /simulator for «Тренажёр»). Pages outside the nav that can be closed too: /desk-day.
 */
export function blockedSectionOf(location: string, nav: unknown): string | null {
  const closed = blockedSections(nav);
  if (!closed.length) return null;
  for (const href of closed) {
    if (href === "/") continue; // the home page is never closed
    const item = ALL_NAV_ITEMS.find((i) => i.href === href);
    if (item ? isNavActive(item, location) : location === href || location.startsWith(href + "/")) return href;
  }
  return null;
}

/** The ladder tier from /permissions/me as the access stage (lead → senior; legacy trainee / none → junior). */
export function stageOfTier(tier: string | null | undefined): "junior" | "trader" | "senior" {
  if (tier === "trader") return "trader";
  if (tier === "senior" || tier === "lead") return "senior";
  return "junior";
}

/** A section the admin table can close: href + label getter, grouped as in the sidebar. */
export type BlockableSection = { href: string; readonly label: string; parent: string | null };
export type BlockableGroup = { id: NavGroup["id"]; readonly label: string; sections: BlockableSection[] };

/** Pages a trader can open that are not in the nav but can be closed per stage (cross-trader views). */
const EXTRA_BLOCKABLE: { href: string; group: NavGroup["id"]; label: () => string }[] = [
  { href: "/desk-day", group: "team", label: () => shellI18n.t("titles.deskDay") },
  // The team feed: now the «Команда» tab of /notifications (its nav item is hidden), still closable per stage.
  { href: "/activity", group: "team", label: () => shellI18n.t("nav.activity") },
];

/**
 * Rows of the «Доступ по ступеням» table: every page a trader normally sees (no staff pages, no hidden ones, no desk
 * switch sections, never the home page), grouped and ordered as in the sidebar, children right after their row.
 */
export function blockableSections(): BlockableGroup[] {
  const ok = (i: NavItem) => !i.staff && !i.hidden && !i.feature && i.href !== "/" && i.href !== "/guide";
  const section = (i: NavItem, parent: string | null): BlockableSection => ({ href: i.href, get label() { return i.name; }, parent });
  return NAV_GROUPS.map((g) => {
    const sections = g.items.flatMap((r) => [
      ...(ok(r) ? [section(r, null)] : []),
      ...(r.children ?? []).filter(ok).map((c) => section(c, ok(r) ? r.href : null)),
    ]);
    for (const x of EXTRA_BLOCKABLE.filter((e) => e.group === g.id)) sections.push({ href: x.href, get label() { return x.label(); }, parent: null });
    return { id: g.id, get label() { return g.label; }, sections };
  }).filter((g) => g.sections.length);
}
