/**
 * Desktop sidebar: «Закреплённые» on top (pinned sub-pages, when any), then ~16 rows grouped by the trader's day, with
 * second-level pages under their row (shown while you are in that set or on the chevron), attention badges only where
 * someone should act, a «Сегодня» footer (own P&L and daily stop, today-card.tsx) and an icon rail (Ctrl/⌘ B). Press G
 * to see every quick-jump letter; the footer «G + буква» hint folds away after the first jump (the list is in «Помощь»).
 */
import React from "react";
import { Link } from "wouter";
import { ChevronRight, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pin, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/ds";
import { Reveal } from "@/components/ds/motion";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSidebar } from "@/components/ui/sidebar";
import { useAuth } from "@/contexts/auth-context";
import { openHelp } from "@/lib/onboarding/store";
import { GO_MODE_EVENT, isNavActive, isWithin, type NavItem } from "./nav";
import { pinnedNavItems, withoutPinned, type SimpleNav } from "./nav-model";
import { useNavModel } from "./use-nav-model";
import { useGoHint, useMoreOpen, usePinnedNav } from "./use-nav-prefs";
import { useRiskToday, useShellBadges, type NavBadge } from "./use-shell-badges";
import { TodayCard } from "./today-card";
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

const MOD_KEY = /Mac|iPhone|iPad/.test(typeof navigator !== "undefined" ? navigator.platform : "") ? "⌘" : "Ctrl";

/** Badge chip / dot. */
function BadgeMark({ badge, className }: { badge: NavBadge; className?: string }) {
  if (badge.count) {
    return (
      <span
        role="img"
        aria-label={badge.label}
        title={badge.label}
        className={cn("grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-2xs font-semibold tabular-nums", BADGE_CLS[badge.tone], className)}
      >
        {badge.count > 99 ? "99+" : badge.count}
      </span>
    );
  }
  return <span role="img" aria-label={badge.label} title={badge.label} className={cn("h-2 w-2 shrink-0 rounded-full", DOT_CLS[badge.tone], className)} />;
}

/**
 * «G X» chip while go mode is on (G pressed): drawn over the right end of the row, so it never takes room from the
 * label or the badge. On hover the row's title says the same («Аналитика: G, затем A»).
 */
function GoHint({ k, go, className }: { k?: string; go: boolean; className: string }) {
  if (!k) return null;
  return (
    <kbd
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute top-1/2 grid h-5 min-w-5 -translate-y-1/2 place-items-center rounded-full bg-primary-solid px-1.5 font-sans text-2xs font-semibold leading-none text-primary-foreground shadow-[0_0_0_2px_hsl(var(--background))] transition-opacity duration-[var(--dur-1)] motion-reduce:transition-none",
        go ? "opacity-100" : "opacity-0",
        className,
      )}
    >
      {k.toUpperCase()}
    </kbd>
  );
}

const rowBase =
  "relative flex items-center gap-3 rounded-full text-[13px] outline-none transition-[background-color,color] duration-[var(--dur-1)] focus-visible:ring-2 focus-visible:ring-ring";
const rowIdle = "text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground";
/** The open page: a quiet tonal pill (foreground at 8% + a hairline), not a solid accent fill (monochrome, 2026-10-24). */
const rowActive =
  "bg-foreground/[0.08] font-medium text-foreground shadow-[inset_0_0_0_1px_hsl(var(--foreground)/0.06)]";
/** The row whose child page is open: named, not filled (one pill per sidebar). */
const rowWithin = "font-medium text-foreground hover:bg-[var(--glass-hover-bg)]";

type RowCtx = {
  location: string;
  badges: Record<string, NavBadge | undefined>;
  go: boolean;
  pins: ReturnType<typeof usePinnedNav>;
  /** Rows opened with the chevron (not persisted). */
  opened: Set<string>;
  toggleOpened: (href: string) => void;
};

/** A second-level page under its row, or (`pinnedRow`) a pinned page in «Закреплённые» with its own icon. */
function ChildLink({ item, ctx, pinnedRow }: { item: NavItem; ctx: RowCtx; pinnedRow?: boolean }) {
  const { t } = shellI18n.useT();
  const active = isNavActive(item, ctx.location);
  const pinned = ctx.pins.isPinned(item.href);
  const blocked = !pinned && !ctx.pins.canPin;
  const badge = ctx.badges[item.href];
  return (
    <li className="group/row relative">
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        onPointerEnter={() => preloadRoute(item.href)}
        onFocus={() => preloadRoute(item.href)}
        title={item.goKey ? t("sidebar.goKeyTitle", { name: item.name, key: item.goKey.toUpperCase() }) : item.name}
        className={cn(rowBase, pinnedRow ? "h-8 pl-3 pr-8" : "ml-[26px] h-7 gap-2 pl-3 pr-8", active ? rowActive : rowIdle)}
      >
        {pinnedRow && <item.icon className={cn("h-4 w-4 shrink-0", active ? "text-foreground" : "text-muted-foreground group-hover/row:text-foreground")} aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate">{item.name}</span>
        {badge && <BadgeMark badge={badge} />}
        <GoHint k={item.goKey} go={ctx.go} className="right-2" />
      </Link>
      <button
        type="button"
        onClick={() => ctx.pins.togglePin(item.href)}
        disabled={blocked}
        aria-label={pinned ? t("sidebar.unpinAria", { name: item.name }) : t("sidebar.pinAria", { name: item.name })}
        aria-pressed={pinned}
        title={pinned ? t("sidebar.unpinTitle") : blocked ? t("sidebar.pinFullTitle") : t("sidebar.pinTitle")}
        className={cn(
          "absolute right-0.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full outline-none transition-opacity duration-[var(--dur-1)] focus-visible:ring-2 focus-visible:ring-ring",
          pinned ? "opacity-70" : "opacity-0",
          "focus-visible:opacity-100 group-hover/row:opacity-100 disabled:cursor-not-allowed disabled:group-hover/row:opacity-40",
          active ? "text-foreground/70 hover:bg-foreground/10" : pinned ? "text-primary hover:bg-[var(--glass-hover-bg)]" : "text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground",
        )}
      >
        <Pin className={cn("h-3.5 w-3.5", pinned && "fill-current")} aria-hidden="true" />
      </button>
    </li>
  );
}

function Row({ row, ctx }: { row: NavItem; ctx: RowCtx }) {
  const { t } = shellI18n.useT();
  // A pinned page is listed once, in «Закреплённые» (OWNER-28): not again under its row.
  const kids = withoutPinned(row.children ?? [], ctx.pins.pins);
  const label = row.name;
  const Icon = row.icon;
  const self = isNavActive(row, ctx.location);
  const within = isWithin(row, ctx.location);
  const open = kids.length > 0 && (within || ctx.opened.has(row.href));
  // A closed row still tells you something inside needs you.
  const badge = ctx.badges[row.href] ?? (open ? undefined : kids.map((k) => ctx.badges[k.href]).find(Boolean));
  const listId = `nav-sub-${row.key}`;
  return (
    <li>
      <div className="group/row relative">
        <Link
          href={row.to ?? row.href}
          aria-current={self ? "page" : undefined}
          onPointerEnter={() => preloadRoute(row.href)}
          onFocus={() => preloadRoute(row.href)}
          className={cn(rowBase, "h-8 pl-3", kids.length ? "pr-9" : "pr-2.5", self ? rowActive : within ? rowWithin : rowIdle)}
        >
          <Icon className={cn("h-4 w-4 shrink-0", self ? "text-foreground" : within ? "text-foreground" : "text-muted-foreground group-hover/row:text-foreground")} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate" title={row.goKey ? t("sidebar.goKeyTitle", { name: label, key: row.goKey.toUpperCase() }) : label}>{label}</span>
          {badge && <BadgeMark badge={badge} />}
          <GoHint k={row.goKey} go={ctx.go} className={kids.length ? "right-9" : "right-2"} />
        </Link>
        {kids.length > 0 && (
          <button
            type="button"
            onClick={() => ctx.toggleOpened(row.href)}
            disabled={within}
            aria-expanded={open}
            aria-controls={listId}
            aria-label={open ? t("sidebar.hideChildren", { name: label }) : t("sidebar.showChildren", { name: label })}
            title={open ? t("sidebar.hideChildren", { name: label }) : t("sidebar.showChildren", { name: label })}
            className={cn(
              "absolute right-1 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full outline-none transition-[background-color,color,opacity] duration-[var(--dur-1)] focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none",
              self ? "text-foreground/70 hover:bg-foreground/10" : "text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground",
              // Inside the set the list is always open: the chevron only shows the state.
              within ? "opacity-50" : "opacity-40 group-hover/row:opacity-100 focus-visible:opacity-100",
            )}
          >
            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform duration-[var(--dur-2)] ease-smooth motion-reduce:transition-none", open && "rotate-90")} aria-hidden="true" />
          </button>
        )}
      </div>
      {kids.length > 0 && (
        <Reveal open={open} id={listId}>
          <ul className="relative space-y-0.5 py-0.5 before:absolute before:inset-y-1 before:left-[19px] before:w-px before:bg-[var(--glass-border)]">
            {kids.map((k) => <ChildLink key={k.href} item={k} ctx={ctx} />)}
          </ul>
        </Reveal>
      )}
    </li>
  );
}

/** Icon-only row of the rail; the label, quick-jump keys and badge live in the tooltip. */
function RailLink({ item, ctx, label, icon, small, self, within }: {
  item: NavItem; ctx: RowCtx; label: string; icon: NavItem["icon"]; small?: boolean; self: boolean; within?: boolean;
}) {
  const Icon = icon;
  const badge = ctx.badges[item.href];
  return (
    <li className="flex justify-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={item.to ?? item.href}
            aria-current={self ? "page" : undefined}
            onPointerEnter={() => preloadRoute(item.href)}
            onFocus={() => preloadRoute(item.href)}
            className={cn(
              "relative grid place-items-center rounded-full outline-none transition-[background-color,color] duration-[var(--dur-1)] focus-visible:ring-2 focus-visible:ring-ring",
              small ? "h-7 w-7" : "h-9 w-9",
              self ? rowActive : within ? "bg-[var(--glass-hover-bg)] text-primary" : rowIdle,
            )}
          >
            <Icon className={small ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden="true" />
            <span className="sr-only">{label}</span>
            {badge && (
              <span aria-hidden="true" className={cn("absolute right-0.5 top-0.5 h-2 w-2 rounded-full ring-2 ring-background", DOT_CLS[badge.tone])} />
            )}
            {ctx.go && item.goKey && (
              <span aria-hidden="true" className="absolute -bottom-1.5 -right-1.5 grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full bg-primary-solid px-1 text-2xs font-semibold leading-none text-primary-foreground">
                {item.goKey.toUpperCase()}
              </span>
            )}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={10} className="flex items-center gap-2">
          <span className="font-medium">{label}</span>
          {item.goKey && <Kbd keys={["G", item.goKey.toUpperCase()]} />}
          {badge && <span className="text-muted-foreground">{badge.label}</span>}
        </TooltipContent>
      </Tooltip>
    </li>
  );
}

function RailRow({ row, ctx }: { row: NavItem; ctx: RowCtx }) {
  const self = isNavActive(row, ctx.location);
  const within = isWithin(row, ctx.location);
  // In the rail a set opens only while you are in it, so its pages stay one click away (pinned ones are on top).
  const shown = within ? withoutPinned(row.children ?? [], ctx.pins.pins) : [];
  return (
    <>
      <RailLink item={row} ctx={ctx} label={row.name} icon={row.icon} self={self} within={within && !self} />
      {shown.map((k) => (
        <RailLink key={`sub-${k.href}`} item={k} ctx={ctx} label={k.name} icon={k.icon} small self={isNavActive(k, ctx.location)} />
      ))}
    </>
  );
}

/**
 * Simple menu: the «Ещё» group under the primary rows — one row that folds every other section (remembered per user;
 * open by itself while you are inside one of its sections). A closed group still shows that something inside needs you.
 */
function MoreGroup({ simple, ctx, rail, open, setOpen }: { simple: SimpleNav; ctx: RowCtx; rail: boolean; open: boolean; setOpen: (v: boolean) => void }) {
  const { t } = shellI18n.useT();
  const within = simple.more.some((r) => isWithin(r, ctx.location));
  const shown = open || within;
  const badge = shown ? undefined : simple.moreItems.map((i) => ctx.badges[i.href]).find(Boolean);
  const label = shown ? t("simple.hideMore") : t("simple.showMore");
  const hint = t(simple.opensAt === "trader" ? "simple.opensAt.trader" : "simple.opensAt.junior");
  const toggle = (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      disabled={within}
      aria-expanded={shown}
      aria-controls="nav-more"
      aria-label={rail ? label : undefined}
      title={label}
      className={cn(
        "relative outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
        rail ? "mx-auto grid h-9 w-9 place-items-center rounded-full transition-[background-color,color] duration-[var(--dur-1)]" : cn(rowBase, "h-8 w-full pl-3 pr-2"),
        rowIdle,
      )}
    >
      <MoreHorizontal className="h-4 w-4 shrink-0" aria-hidden="true" />
      {!rail && <span className="min-w-0 flex-1 truncate text-left">{t("simple.more")}</span>}
      {badge && (rail
        ? <span aria-hidden="true" className={cn("absolute right-0.5 top-0.5 h-2 w-2 rounded-full ring-2 ring-background", DOT_CLS[badge.tone])} />
        : <BadgeMark badge={badge} />)}
      {!rail && <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 opacity-60 transition-transform duration-[var(--dur-2)] ease-smooth motion-reduce:transition-none", shown && "rotate-90")} aria-hidden="true" />}
    </button>
  );
  return (
    <section aria-label={t("simple.more")} className={rail ? "mt-1.5 border-t border-[var(--glass-border)] pt-1.5" : "pt-2.5"}>
      {rail ? <Tooltip><TooltipTrigger asChild>{toggle}</TooltipTrigger><TooltipContent side="right" sideOffset={10}>{label}</TooltipContent></Tooltip> : toggle}
      <Reveal open={shown} id="nav-more">
        {!rail && <p className="px-3 pb-1 pt-0.5 text-2xs leading-snug text-muted-foreground">{hint}</p>}
        <ul className={cn("space-y-0.5", rail && "pt-0.5")}>
          {simple.more.map((row) => (rail ? <RailRow key={row.href} row={row} ctx={ctx} /> : <Row key={row.href} row={row} ctx={ctx} />))}
        </ul>
      </Reveal>
    </section>
  );
}

/**
 * «Закреплённые»: pinned sub-pages one click away at the top (each with its own icon and an «Открепить» pin). Pin a
 * page from its row's list (the pin on hover); the admin starts with «Статистика офиса» (use-nav-prefs DEFAULT_PINS).
 */
function PinnedGroup({ items, ctx, rail }: { items: NavItem[]; ctx: RowCtx; rail: boolean }) {
  const { t } = shellI18n.useT();
  if (!items.length) return null;
  if (rail) {
    return (
      <section aria-label={t("sidebar.favorites")} className="border-b border-[var(--glass-border)] pb-1.5 pt-1.5">
        <ul className="space-y-0.5">
          {items.map((i) => <RailLink key={`pin-${i.href}`} item={i} ctx={ctx} label={i.name} icon={i.icon} self={isNavActive(i, ctx.location)} />)}
        </ul>
      </section>
    );
  }
  return (
    <section aria-labelledby="nav-group-pinned" className="pt-1.5">
      <h3 id="nav-group-pinned" className="micro-label flex items-center gap-1.5 px-3 pb-0.5" title={t("sidebar.pinnedTitle")}>
        <Pin className="h-3 w-3 fill-current" aria-hidden="true" />{t("sidebar.favorites")}
      </h3>
      <ul className="space-y-0.5">
        {items.map((i) => <ChildLink key={`pin-${i.href}`} item={i} ctx={ctx} pinnedRow />)}
      </ul>
    </section>
  );
}

/** «G + буква» until the first quick jump: a click opens «Помощь» (every letter), × folds it away for good. */
function GoHintChip({ onDone }: { onDone: () => void }) {
  const { t } = shellI18n.useT();
  return (
    <span className="group/hint inline-flex min-w-0 items-center gap-0.5">
      <button
        type="button"
        onClick={() => { onDone(); openHelp(); }}
        title={`${t("sidebar.goHint")}. ${t("sidebar.goHintOpen")}`}
        className="inline-flex min-w-0 items-center gap-1 truncate rounded-full px-1 py-0.5 outline-none transition-colors duration-[var(--dur-1)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Kbd>G</Kbd>{t("sidebar.goLetter")}
      </button>
      <button
        type="button"
        onClick={onDone}
        aria-label={t("sidebar.goHintDismiss")}
        title={t("sidebar.goHintDismiss")}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full opacity-60 outline-none transition-opacity duration-[var(--dur-1)] hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </span>
  );
}

// Trades arrive from the broker automatically, so the sidebar offers no manual entry.
export function SidebarNav({ location }: { location: string }) {
  const { groups, simple } = useNavModel();
  const { t } = shellI18n.useT();
  const { user, isCurator, permissions } = useAuth();
  const [moreOpen, setMoreOpen] = useMoreOpen(user?.traderName);
  const [goHint, doneGoHint] = useGoHint();
  const { state, isMobile, toggleSidebar } = useSidebar();
  const rail = state === "collapsed" && !isMobile;
  const pins = usePinnedNav(user?.role);
  const pinned = React.useMemo(() => pinnedNavItems(pins.pins, isCurator, permissions.nav), [pins.pins, isCurator, permissions.nav]);
  /** Rows minus pinned pages (a sub-page lifted to a row is listed once, in «Закреплённые»). */
  const rowsOf = (rows: readonly NavItem[]) => withoutPinned(rows, pins.pins);
  const badges = useShellBadges();
  const { data: risk } = useRiskToday();
  // The footer shows the trader's own day; a curator without limits or trades today gets no empty card.
  const showToday = !!risk && (risk.hasLimits || risk.trades > 0);
  // The footer already carries the risk state: no second signal on the «Риск-деск» row.
  const rowBadges = React.useMemo(() => (showToday ? { ...badges, "/risk": undefined } : badges), [badges, showToday]);

  const [opened, setOpened] = React.useState<Set<string>>(() => new Set());
  const toggleOpened = React.useCallback((href: string) => {
    setOpened((prev) => {
      const next = new Set(prev);
      if (next.has(href)) next.delete(href); else next.add(href);
      return next;
    });
  }, []);

  // Go mode: G pressed somewhere (palette key handler) → show every letter for a moment.
  const [go, setGo] = React.useState(false);
  React.useEffect(() => {
    let timer = 0;
    const on = (e: Event) => {
      window.clearTimeout(timer);
      const v = (e as CustomEvent<boolean>).detail !== false;
      setGo(v);
      // The first quick jump: the footer hint has done its job.
      if (v) doneGoHint();
      if (v) timer = window.setTimeout(() => setGo(false), 1300);
    };
    window.addEventListener(GO_MODE_EVENT, on);
    return () => { window.removeEventListener(GO_MODE_EVENT, on); window.clearTimeout(timer); };
  }, [doneGoHint]);
  React.useEffect(() => setGo(false), [location]);

  // Keep the current section visible in the (scrollable) list after navigation.
  const listRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => {
      const list = listRef.current;
      const el = list?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!list || !el) return;
      const l = list.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (r.top < l.top || r.bottom > l.bottom) el.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(id);
  }, [location, rail, simple]);

  const ctx: RowCtx = { location, badges: rowBadges, go, pins, opened, toggleOpened };

  return (
    <nav aria-label={t("sidebar.navLabel")} data-tour="nav" className="flex min-h-0 flex-1 flex-col">
      <div ref={listRef} className={cn("scrollbar-none min-h-0 flex-1 overflow-y-auto pb-2", rail ? "px-1.5" : "px-2")}>
        <PinnedGroup items={pinned} ctx={ctx} rail={rail} />
        {simple ? (
          <>
            <ul className="space-y-0.5 pt-1.5">
              {rowsOf(simple.primary).map((row) => (rail ? <RailRow key={row.href} row={row} ctx={ctx} /> : <Row key={row.href} row={row} ctx={ctx} />))}
            </ul>
            <MoreGroup simple={{ ...simple, more: rowsOf(simple.more) }} ctx={ctx} rail={rail} open={moreOpen} setOpen={setMoreOpen} />
          </>
        ) : groups.map((g, gi) =>
          rail ? (
            <section key={g.id} aria-label={g.label} className={cn(gi === 0 ? "pt-1.5" : "mt-1.5 border-t border-[var(--glass-border)] pt-1.5")}>
              <ul className="space-y-0.5">
                {rowsOf(g.rows).map((row) => <RailRow key={row.href} row={row} ctx={ctx} />)}
              </ul>
            </section>
          ) : (
            <section key={g.id} aria-labelledby={`nav-group-${g.id}`} className="pt-2.5 first:pt-1.5">
              <h3 id={`nav-group-${g.id}`} className="micro-label px-3 pb-0.5">{g.label}</h3>
              <ul className="space-y-0.5">
                {rowsOf(g.rows).map((row) => <Row key={row.href} row={row} ctx={ctx} />)}
              </ul>
            </section>
          ),
        )}
      </div>
      {(showToday || !isMobile) && (
        <div className={cn("border-t border-[var(--glass-border)]", rail ? "space-y-1 px-1.5 py-2" : "px-2 pb-1.5 pt-1")}>
          {showToday && risk && <TodayCard risk={risk} rail={rail} />}
          {!isMobile && (
            <div className={cn("flex items-center text-2xs text-muted-foreground", rail ? "justify-center" : "justify-end gap-2 pl-1.5 pr-0.5")}>
              {!rail && goHint && <span className="mr-auto min-w-0"><GoHintChip onDone={doneGoHint} /></span>}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={toggleSidebar}
                    aria-label={rail ? t("sidebar.fromRail") : t("sidebar.toRail")}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full outline-none transition-[background-color,color] duration-[var(--dur-1)] hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {rail ? <PanelLeftOpen className="h-4 w-4" aria-hidden="true" /> : <PanelLeftClose className="h-4 w-4" aria-hidden="true" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side={rail ? "right" : "top"} className="flex items-center gap-2">
                  {rail ? t("sidebar.fromRail") : t("sidebar.toRail")}
                  <Kbd keys={[MOD_KEY, "B"]} />
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
