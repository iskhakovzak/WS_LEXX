/** Phone «More» sheet: every section + favourites + search. Own chunk (vaul): loaded on the phone layout when the
 * browser is idle, or on the first tap on «More». */
import { Link } from "wouter";
import { Search, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { isNavActive, type NavItem } from "./nav";
import type { NavBadge } from "./use-shell-badges";
import type { useVisibleNav } from "./sidebar-nav";
import { preloadRoute } from "./route-loaders";
import { openCommandPalette } from "./palette-launcher";
import { shellI18n } from "@/i18n/ns/shell";

function Tile({ item, active, alert }: { item: NavItem; active: boolean; alert?: boolean }) {
  const { t } = shellI18n.useT();
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onPointerDown={() => preloadRoute(item.href)}
      className={cn(
        "relative flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl px-1 py-2 text-center text-xs font-medium transition-colors",
        active ? "bg-primary-solid text-primary-foreground" : "glass-panel text-foreground active:bg-[var(--glass-hover-bg)]",
      )}
    >
      <Icon className={cn("h-5 w-5", active ? "text-primary-foreground" : "text-primary")} aria-hidden="true" />
      <span className="line-clamp-2 leading-tight">{item.name}</span>
      {alert && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-down" aria-label={t("mobile.needsAttention")} />}
    </Link>
  );
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  location: string;
  groups: ReturnType<typeof useVisibleNav>;
  pinnedItems: NavItem[];
  badges: Record<string, NavBadge | undefined>;
};

export default function MobileMoreSheet({ open: moreOpen, onOpenChange: setMoreOpen, location, groups, pinnedItems, badges }: Props) {
  const { t } = shellI18n.useT();
  return (
    <Drawer open={moreOpen} onOpenChange={setMoreOpen} shouldScaleBackground={false}>
      <DrawerContent aria-describedby="more-desc">
        <DrawerTitle className="sr-only">{t("mobile.allSections")}</DrawerTitle>
        <DrawerDescription id="more-desc" className="sr-only">{t("mobile.allSectionsDesc")}</DrawerDescription>
        <div className="overflow-y-auto overscroll-contain px-4 pb-4 pt-3">
          <button
            type="button"
            onClick={() => { setMoreOpen(false); openCommandPalette(); }}
            className="glass-field mb-4 flex h-11 w-full items-center gap-2 px-4 text-sm text-muted-foreground"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            {t("mobile.searchPlaceholder")}
          </button>
          {pinnedItems.length > 0 && (
            <section className="mb-4">
              <h3 className="micro-label mb-2 flex items-center gap-1.5"><Star className="h-3 w-3" aria-hidden="true" /> {t("sidebar.favorites")}</h3>
              <div className="grid grid-cols-3 gap-2">
                {pinnedItems.map((i) => <Tile key={`p-${i.href}`} item={i} active={isNavActive(i, location)} alert={!!badges[i.href]} />)}
              </div>
            </section>
          )}
          {groups.map((g) => (
            <section key={g.id} className="mb-4 last:mb-0">
              <h3 className="micro-label mb-2">{g.label}</h3>
              <div className="grid grid-cols-3 gap-2">
                {g.items.map((i) => <Tile key={i.href} item={i} active={isNavActive(i, location)} alert={!!badges[i.href]} />)}
              </div>
            </section>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
