/** Desktop sidebar navigation: favourites, collapsible workflow groups, accent-pill active item, attention badges. */
import React from "react";
import { Link } from "wouter";
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/ds";
import { Reveal } from "@/components/ds/motion";
import { useAuth } from "@/contexts/auth-context";
import { NAV_GROUPS, ALL_NAV_ITEMS, isNavActive, type NavItem } from "./nav";
import { useCollapsedGroups, usePinnedNav } from "./use-nav-prefs";
import { useShellBadges, type NavBadge } from "./use-shell-badges";
import { preloadRoute } from "./route-loaders";
import { shellI18n } from "@/i18n/ns/shell";

const BADGE_CLS: Record<NavBadge["tone"], string> = {
  down: "bg-down/12 text-down",
  warn: "bg-warn/12 text-warn",
  up: "bg-up/12 text-up",
};
const DOT_CLS: Record<NavBadge["tone"], string> = {
  down: "bg-down",
  warn: "bg-warn",
  up: "bg-up",
};

/** Visible nav for the current role (staff-only items filtered, hidden items dropped). */
export function useVisibleNav() {
  const { isCurator } = useAuth();
  const groups = NAV_GROUPS.map((g) => {
    const items = g.items.filter((i) => !i.hidden && (!i.staff || isCurator));
    // A trader sees only the member items of a staff group: name it for what is left («Admin» → «Account»).
    const label = g.memberLabel && !items.some((i) => i.staff) ? g.memberLabel : g.label;
    return { ...g, label, items };
  }).filter((g) => g.items.length);
  return groups;
}

function NavLink({
  item,
  location,
  badge,
  pinned,
  onTogglePin,
  pinFull = false,
}: {
  item: NavItem;
  location: string;
  badge?: NavBadge;
  pinned: boolean;
  onTogglePin: () => void;
  /** Favourites are full (MAX_PINS): the star can only un-pin. */
  pinFull?: boolean;
}) {
  const { t } = shellI18n.useT();
  const pinBlocked = !pinned && pinFull;
  const active = isNavActive(item, location);
  const Icon = item.icon;
  return (
    <li className="group/nav relative">
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        onPointerEnter={() => preloadRoute(item.href)}
        onFocus={() => preloadRoute(item.href)}
        className={cn(
          "flex h-9 items-center gap-3 rounded-full pl-3 pr-9 text-[13px] transition-[background-color,color] duration-200",
          active
            ? "bg-primary-solid font-medium text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.22),0_6px_16px_-8px_hsl(var(--primary)/0.7)]"
            : "text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground",
        )}
      >
        <Icon className={cn("h-4 w-4 shrink-0", active ? "text-primary-foreground" : "text-muted-foreground group-hover/nav:text-foreground")} aria-hidden="true" />
        <span className="flex-1 truncate">{item.name}</span>
        {badge && (badge.count ? (
          <span aria-label={badge.label} className={cn("rounded-full px-1.5 py-0.5 text-2xs font-semibold tabular-nums", active ? "bg-primary-foreground/20 text-primary-foreground" : BADGE_CLS[badge.tone])}>
            {badge.count}
          </span>
        ) : (
          <span role="img" aria-label={badge.label} className={cn("h-2 w-2 rounded-full", DOT_CLS[badge.tone])} />
        ))}
      </Link>
      <button
        type="button"
        onClick={onTogglePin}
        disabled={pinBlocked}
        aria-label={pinned ? t("sidebar.unpinAria", { name: item.name }) : t("sidebar.pinAria", { name: item.name })}
        aria-pressed={pinned}
        title={pinned ? t("sidebar.unpinTitle") : pinBlocked ? t("sidebar.pinFullTitle") : t("sidebar.pinTitle")}
        className={cn(
          "absolute right-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full transition-opacity",
          "opacity-0 focus-visible:opacity-100 group-hover/nav:opacity-100 [@media(hover:none)]:opacity-100 disabled:cursor-not-allowed disabled:group-hover/nav:opacity-40",
          active ? "text-primary-foreground/90 hover:bg-primary-foreground/15" : "text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground",
        )}
      >
        <Star className={cn("h-3.5 w-3.5", pinned && "fill-current")} aria-hidden="true" />
      </button>
    </li>
  );
}

// Trades arrive from the broker automatically, so the sidebar offers no manual entry.
export function SidebarNav({ location }: { location: string }) {
  const groups = useVisibleNav();
  const { t } = shellI18n.useT();
  const { pins, togglePin, isPinned, canPin } = usePinnedNav();
  const { isCollapsed, toggleGroup, setAll } = useCollapsedGroups();
  const badges = useShellBadges();
  const { isCurator } = useAuth();
  const pinnedItems = pins
    .map((h) => ALL_NAV_ITEMS.find((i) => i.href === h))
    .filter((i): i is NavItem => !!i && !i.hidden && (!i.staff || isCurator));
  // The group holding the current page is always shown expanded (even if folded by default, e.g. Академия),
  // unless the user folds it right here; that local choice resets when you move to another group.
  const activeGroupId = groups.find((g) => g.items.some((i) => isNavActive(i, location)))?.id ?? null;
  const [foldedHere, setFoldedHere] = React.useState<string | null>(null);
  React.useEffect(() => setFoldedHere(null), [activeGroupId]);
  const groupFolded = (id: string) => (id === activeGroupId ? foldedHere === id : isCollapsed(id));
  const onToggleGroup = (id: string) => {
    if (id !== activeGroupId) return toggleGroup(id);
    const fold = foldedHere !== id;
    setFoldedHere(fold ? id : null);
    if (fold !== isCollapsed(id)) toggleGroup(id);
  };
  const allFolded = groups.length > 0 && groups.every((g) => groupFolded(g.id));
  // Keep the current section visible in the (scrollable) list after navigation, e.g. Академия at the bottom.
  const listRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => {
      const list = listRef.current;
      const el = list?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!list || !el) return;
      // Only when it is out of view, and then to the middle (with its group around it), not glued to an edge.
      const l = list.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (r.top < l.top || r.bottom > l.bottom) el.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(id);
  }, [location]);
  const onToggleAll = () => {
    setAll(groups.map((g) => g.id), !allFolded);
    setFoldedHere(!allFolded ? activeGroupId : null);
  };

  return (
    <nav aria-label={t("sidebar.navLabel")} className="flex min-h-0 flex-1 flex-col">
      <div ref={listRef} className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {pinnedItems.length > 0 && (
          <section className="pt-2">
            <h3 className="micro-label flex items-center gap-1.5 px-3 pb-1.5 pt-1">
              <Star className="h-3 w-3" aria-hidden="true" /> {t("sidebar.favorites")}
            </h3>
            <ul className="space-y-0.5">
              {pinnedItems.map((item) => (
                <NavLink key={`pin-${item.href}`} item={item} location={location} badge={badges[item.href]} pinned onTogglePin={() => togglePin(item.href)} pinFull={!canPin} />
              ))}
            </ul>
          </section>
        )}
        {groups.map((g) => {
          const collapsed = groupFolded(g.id);
          const activeItem = g.items.find((i) => isNavActive(i, location));
          const groupAlert = g.items.map((i) => badges[i.href]).find(Boolean);
          const listId = `nav-group-${g.id}`;
          return (
            <section key={g.id} className="pt-2">
              <button
                type="button"
                onClick={() => onToggleGroup(g.id)}
                aria-expanded={!collapsed}
                aria-controls={listId}
                className="micro-label group/hdr flex w-full items-center gap-1.5 rounded-full px-3 pb-1.5 pt-1 text-left transition-colors duration-[var(--dur-1)] hover:text-foreground"
              >
                <span className="flex-1">{g.label}</span>
                {collapsed && groupAlert && (
                  <span role="img" aria-label={groupAlert.label} className={cn("h-1.5 w-1.5 rounded-full", DOT_CLS[groupAlert.tone])} />
                )}
                {collapsed && <span className="text-2xs font-medium normal-case tracking-normal tabular-nums opacity-80">{g.items.length}</span>}
                <ChevronDown className={cn("h-3 w-3 transition-transform duration-[var(--dur-2)] ease-smooth", collapsed && "-rotate-90")} aria-hidden="true" />
              </button>
              {/* A folded group still shows where you are: the active section stays visible. */}
              {collapsed && activeItem && (
                <ul className="space-y-0.5">
                  <NavLink
                    item={activeItem}
                    location={location}
                    badge={badges[activeItem.href]}
                    pinned={isPinned(activeItem.href)}
                    onTogglePin={() => togglePin(activeItem.href)}
                    pinFull={!canPin}
                  />
                </ul>
              )}
              <Reveal open={!collapsed} id={listId}>
                <ul className="space-y-0.5">
                  {g.items.map((item) => (
                    <NavLink
                      key={item.href}
                      item={item}
                      location={location}
                      badge={badges[item.href]}
                      pinned={isPinned(item.href)}
                      onTogglePin={() => togglePin(item.href)}
                      pinFull={!canPin}
                    />
                  ))}
                </ul>
              </Reveal>
            </section>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-[var(--glass-border)] px-3 py-2 text-2xs text-muted-foreground">
        <span className="inline-flex min-w-0 items-center gap-1 truncate" title={t("sidebar.goHint")}>
          <Kbd>G</Kbd>{t("sidebar.goLetter")}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onToggleAll}
            aria-label={allFolded ? t("sidebar.expandAllAria") : t("sidebar.collapseAllAria")}
            title={allFolded ? t("sidebar.expandAll") : t("sidebar.collapseAll")}
            className="grid h-7 w-7 place-items-center rounded-full transition-colors duration-[var(--dur-1)] hover:bg-[var(--glass-hover-bg)] hover:text-foreground"
          >
            {allFolded ? <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronsDownUp className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
          <span title={t("sidebar.toggleSidebar")}>
            <Kbd keys={[/Mac|iPhone|iPad/.test(typeof navigator !== "undefined" ? navigator.platform : "") ? "⌘" : "Ctrl", "B"]} />
          </span>
        </span>
      </div>
    </nav>
  );
}
