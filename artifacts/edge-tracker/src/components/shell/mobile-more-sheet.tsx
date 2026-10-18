/** Phone «More» sheet: every section + favourites + search (simple menu: «Главное» + a folded «Ещё», nav-model.ts). Own chunk (vaul): loaded on the phone layout when the
 * browser is idle, or on the first tap on «More». */
import { Link } from "wouter";
import { ChevronRight, Search, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { isNavActive, type NavItem } from "./nav";
import type { NavBadge } from "./use-shell-badges";
import type { SimpleNav, VisibleGroup } from "./nav-model";
import { preloadRoute } from "./route-loaders";
import { openCommandPalette } from "./palette-launcher";
import { shellI18n } from "@/i18n/ns/shell";

function Tile({ item, active, alert }: { item: NavItem; active: boolean; alert?: boolean }) {
  const { t } = shellI18n.useT();
  const Icon = item.icon;
  return (
    <Link
      href={item.to ?? item.href}
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
  groups: VisibleGroup[];
  pinnedItems: NavItem[];
  badges: Record<string, NavBadge | undefined>;
  /** Simple menu (new traders): the primary sections not in the tab bar, then one folded «Ещё» group. */
  simple?: SimpleNav | null;
  moreGroupOpen?: boolean;
  setMoreGroupOpen?: (open: boolean) => void;
};

const grid = "grid grid-cols-3 gap-2";

/** Simple menu in the sheet: «Главное» (the primary sections the tab bar has no room for) + the folded «Ещё» group. */
function SimpleSections({ simple, location, badges, open, setOpen }: {
  simple: SimpleNav; location: string; badges: Props["badges"]; open: boolean; setOpen: (v: boolean) => void;
}) {
  const { t } = shellI18n.useT();
  const within = simple.moreItems.some((i) => isNavActive(i, location));
  const shown = open || within;
  const alert = !shown && simple.moreItems.some((i) => badges[i.href]);
  return (
    <>
      {simple.primary.length > 0 && (
        <section className="mb-4">
          <h3 className="micro-label mb-2">{t("simple.main")}</h3>
          <div className={grid}>
            {simple.primary.map((i) => <Tile key={i.href} item={i} active={isNavActive(i, location)} alert={!!badges[i.href]} />)}
          </div>
        </section>
      )}
      <section>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          disabled={within}
          aria-expanded={shown}
          aria-controls="sheet-more"
          className="micro-label mb-1 flex h-10 w-full items-center gap-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
        >
          <span>{t("simple.more")}</span>
          <ChevronRight className={cn("h-3 w-3 transition-transform duration-[var(--dur-2)] motion-reduce:transition-none", shown && "rotate-90")} aria-hidden="true" />
          {alert && <span className="h-2 w-2 rounded-full bg-down" aria-label={t("mobile.needsAttention")} />}
          <span className="sr-only">{shown ? t("simple.hideMore") : t("simple.showMore")}</span>
        </button>
        {shown && (
          <div id="sheet-more">
            <p className="mb-2 text-xs text-muted-foreground">{t(simple.opensAt === "trader" ? "simple.opensAt.trader" : "simple.opensAt.junior")}</p>
            <div className={grid}>
              {simple.moreItems.map((i) => <Tile key={i.href} item={i} active={isNavActive(i, location)} alert={!!badges[i.href]} />)}
            </div>
          </div>
        )}
      </section>
    </>
  );
}

export default function MobileMoreSheet({ open: moreOpen, onOpenChange: setMoreOpen, location, groups, pinnedItems, badges, simple, moreGroupOpen = false, setMoreGroupOpen }: Props) {
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
              <div className={grid}>
                {pinnedItems.map((i) => <Tile key={`p-${i.href}`} item={i} active={isNavActive(i, location)} alert={!!badges[i.href]} />)}
              </div>
            </section>
          )}
          {simple ? (
            <SimpleSections simple={simple} location={location} badges={badges} open={moreGroupOpen} setOpen={(v) => setMoreGroupOpen?.(v)} />
          ) : groups.map((g) => (
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
