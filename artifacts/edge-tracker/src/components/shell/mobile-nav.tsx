/**
 * Phone navigation (below 768 px): a floating bottom dock with the five main screens — Главная, Сделки, Дневник,
 * Аналитика, Риск (nav-model.ts MOBILE_TABS; a screen the viewer cannot open is left out) — plus «Ещё», which opens the
 * sheet with the rest of the sidebar. Icon + short label, 48 px targets, safe-area inset at the bottom; hidden while the
 * on-screen keyboard is open and in print. The header keeps only secondary things (search, bell, user menu).
 */
import React, { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { isNavActive } from "./nav";
import { mobileTabs, pinnedNavItems, simpleWithoutDock, withoutDock } from "./nav-model";
import { useSoftKeyboardOpen } from "./use-soft-keyboard";
import { useNavModel } from "./use-nav-model";
import { useMoreOpen, usePinnedNav } from "./use-nav-prefs";
import { useShellBadges } from "./use-shell-badges";
import { preloadRoute } from "./route-loaders";
import { useAuth } from "@/contexts/auth-context";
import { shellI18n } from "@/i18n/ns/shell";

const loadSheet = () => import("./mobile-more-sheet");
const MobileMoreSheet = lazy(loadSheet);
const PHONE = "(max-width: 767px)";

/** 48 px tall target (≥ 44), icon over a short label. */
const dockItem =
  "relative mx-auto flex h-12 w-full flex-col items-center justify-center gap-0.5 rounded-2xl text-2xs leading-none outline-none transition-colors duration-[var(--dur-1)] focus-visible:ring-2 focus-visible:ring-ring [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]";
const dockPill = "grid h-7 w-11 place-items-center rounded-full transition-colors duration-[var(--dur-1)]";
/** The open screen: the sidebar's quiet tonal pill (foreground at 8% + a hairline), monochrome. */
const dockPillActive = "bg-foreground/[0.08] shadow-[inset_0_0_0_1px_hsl(var(--foreground)/0.06)]";
const dockDot = "absolute right-[calc(50%-1.125rem)] top-1 h-2 w-2 rounded-full bg-down";

export function MobileNav({ location }: { location: string }) {
  const [moreOpen, setMoreOpen] = useState(false);
  // The sheet chunk is mounted (closed) once loaded: on the phone layout when idle, or on the first press on «More».
  const [sheetArmed, setSheetArmed] = useState(false);
  const arm = useCallback(() => { void loadSheet().then(() => setSheetArmed(true), () => {}); }, []);
  const { t } = shellI18n.useT();
  const { groups, simple } = useNavModel();
  const { isCurator, user, permissions } = useAuth();
  // Same pins as the sidebar, role defaults included (the admin's «Статистика офиса»).
  const { pins } = usePinnedNav(user?.role);
  const [moreGroupOpen, setMoreGroupOpen] = useMoreOpen(user?.traderName);
  const badges = useShellBadges();
  const keyboardOpen = useSoftKeyboardOpen();
  // Главная, Сделки, Дневник (juniors: «Вечер»), Аналитика, Риск — those this viewer may open — + «Ещё».
  const tabs = React.useMemo(() => mobileTabs(groups, simple), [groups, simple]);
  const tabHrefs = React.useMemo(() => tabs.map((i) => i.href), [tabs]);
  // The sheet lists the rest of the sidebar (the dock's screens taken out, their children kept).
  const sheetGroups = React.useMemo(() => withoutDock(groups, tabHrefs), [groups, tabHrefs]);
  const sheetSimple = React.useMemo(() => (simple ? simpleWithoutDock(simple, tabHrefs) : null), [simple, tabHrefs]);
  const inTabs = tabs.some((t) => isNavActive(t, location));
  // «Закреплённые» on top, by the sidebar's rule (staff-only / closed-for-the-stage pins never show).
  const pinnedItems = React.useMemo(() => pinnedNavItems(pins, isCurator, permissions.nav), [pins, isCurator, permissions.nav]);
  const anyAlert = Object.entries(badges).some(([href, b]) => b && !tabHrefs.includes(href));

  useEffect(() => { setMoreOpen(false); }, [location]);
  useEffect(() => {
    if (!window.matchMedia?.(PHONE).matches) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(arm, { timeout: 5000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const timer = setTimeout(arm, 3000);
    return () => clearTimeout(timer);
  }, [arm]);

  return (
    <>
      <nav
        aria-label={t("mobile.navLabel")}
        data-tour="dock"
        data-keyboard={keyboardOpen ? "open" : undefined}
        inert={keyboardOpen}
        className={cn(
          "glass-thick pb-safe fixed inset-x-1.5 bottom-2 z-nav rounded-[22px] px-0.5 pt-1 transition-[transform,opacity] duration-[var(--dur-2)] motion-reduce:transition-none md:hidden print:hidden",
          keyboardOpen && "pointer-events-none translate-y-[calc(100%+1rem)] opacity-0",
        )}
      >
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}>
          {tabs.map((t) => {
            const active = isNavActive(t, location);
            const Icon = t.icon;
            return (
              <li key={t.href}>
                <Link
                  href={t.to ?? t.href}
                  aria-current={active ? "page" : undefined}
                  onPointerDown={() => preloadRoute(t.href)}
                  className={cn(dockItem, active ? "font-medium text-foreground" : "text-muted-foreground active:text-foreground")}
                >
                  <span className={cn(dockPill, active && dockPillActive)}>
                    <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                  </span>
                  <span className="max-w-full truncate tracking-[-0.01em]">{t.short ?? t.name}</span>
                  {badges[t.href] && <><span className={dockDot} aria-hidden="true" /><span className="sr-only">{badges[t.href]!.label}</span></>}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onPointerDown={arm}
              onClick={() => { setSheetArmed(true); setMoreOpen(true); }}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className={cn(dockItem, !inTabs ? "font-medium text-foreground" : "text-muted-foreground active:text-foreground")}
            >
              <span className={cn(dockPill, !inTabs && dockPillActive)}>
                <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden="true" />
              </span>
              <span className="max-w-full truncate tracking-[-0.01em]">{t("mobile.more")}</span>
              {anyAlert && <><span className={dockDot} aria-hidden="true" /><span className="sr-only">{t("mobile.hasWarnings")}</span></>}
            </button>
          </li>
        </ul>
      </nav>

      {sheetArmed && (
        <Suspense fallback={null}>
          <MobileMoreSheet
            open={moreOpen} onOpenChange={setMoreOpen} location={location} groups={sheetGroups} pinnedItems={pinnedItems} badges={badges}
            simple={sheetSimple}
            moreGroupOpen={moreGroupOpen} setMoreGroupOpen={setMoreGroupOpen}
          />
        </Suspense>
      )}
    </>
  );
}
