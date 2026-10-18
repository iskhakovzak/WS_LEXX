/** Phone navigation: a floating bottom tab bar (4 key sections + «More») and a bottom sheet with every section. */
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { ALL_NAV_ITEMS, MOBILE_TABS, isNavActive, type NavItem } from "./nav";
import { useVisibleNav } from "./sidebar-nav";
import { usePinnedNav } from "./use-nav-prefs";
import { useShellBadges } from "./use-shell-badges";
import { preloadRoute } from "./route-loaders";
import { useAuth } from "@/contexts/auth-context";
import { shellI18n } from "@/i18n/ns/shell";

const loadSheet = () => import("./mobile-more-sheet");
const MobileMoreSheet = lazy(loadSheet);
const PHONE = "(max-width: 767px)";

export function MobileNav({ location }: { location: string }) {
  const [moreOpen, setMoreOpen] = useState(false);
  // The sheet chunk is mounted (closed) once loaded: on the phone layout when idle, or on the first press on «More».
  const [sheetArmed, setSheetArmed] = useState(false);
  const arm = useCallback(() => { void loadSheet().then(() => setSheetArmed(true), () => {}); }, []);
  const { t } = shellI18n.useT();
  const groups = useVisibleNav();
  const { pins } = usePinnedNav();
  const { isCurator } = useAuth();
  const badges = useShellBadges();
  const tabs = MOBILE_TABS.map((h) => ALL_NAV_ITEMS.find((i) => i.href === h)).filter((i): i is NavItem => !!i);
  const inTabs = tabs.some((t) => isNavActive(t, location));
  // Same rule as the sidebar: a staff-only section pinned while signed in as curator never shows for a trader.
  const pinnedItems = pins.map((h) => ALL_NAV_ITEMS.find((i) => i.href === h)).filter((i): i is NavItem => !!i && !i.hidden && (!i.staff || isCurator));
  const anyAlert = Object.entries(badges).some(([href, b]) => b && !MOBILE_TABS.includes(href));

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
        className="glass-thick pb-safe fixed inset-x-2 bottom-2 z-nav rounded-[22px] px-1.5 pt-1.5 md:hidden"
      >
        <ul className="grid grid-cols-5">
          {tabs.map((t) => {
            const active = isNavActive(t, location);
            const Icon = t.icon;
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  onPointerDown={() => preloadRoute(t.href)}
                  className={cn(
                    "relative mx-auto flex h-12 flex-col items-center justify-center gap-0.5 rounded-2xl text-2xs font-medium transition-colors",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <span className={cn("grid h-7 w-12 place-items-center rounded-full transition-colors", active && "bg-primary/15")}>
                    <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                  </span>
                  {t.short ?? t.name}
                  {badges[t.href] && <span className="absolute right-3 top-1 h-2 w-2 rounded-full bg-down" aria-label={badges[t.href]!.label} />}
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
              className={cn(
                "relative mx-auto flex h-12 w-full flex-col items-center justify-center gap-0.5 rounded-2xl text-2xs font-medium",
                !inTabs ? "text-primary" : "text-muted-foreground",
              )}
            >
              <span className={cn("grid h-7 w-12 place-items-center rounded-full", !inTabs && "bg-primary/15")}>
                <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden="true" />
              </span>
              {t("mobile.more")}
              {anyAlert && <span className="absolute right-3 top-1 h-2 w-2 rounded-full bg-down" aria-label={t("mobile.hasWarnings")} />}
            </button>
          </li>
        </ul>
      </nav>

      {sheetArmed && (
        <Suspense fallback={null}>
          <MobileMoreSheet open={moreOpen} onOpenChange={setMoreOpen} location={location} groups={groups} pinnedItems={pinnedItems} badges={badges} />
        </Suspense>
      )}
    </>
  );
}
