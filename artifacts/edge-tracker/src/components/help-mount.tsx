/**
 * Glue between the shell's navigation model and the help feature (features never import each other): who is looking
 * (role, ladder tier, which sections are open — a «Дальше» link or a guide entry never points at a closed or staff-only
 * section) and the page header's «?» (the help of the page the URL belongs to). Mounted once by components/layout.tsx.
 */
import { useCallback, useMemo, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { ALL_NAV_ITEMS, navItemFor } from "@/components/shell/nav";
import { navItemOpen } from "@/components/shell/nav-model";
import { registerPageHelp } from "@/components/ds/page-help-slot";
import { HelpAccessProvider, ToolHelp } from "@/components/shared/tool-help";
import { isHelpId, type HelpViewer } from "@/lib/help/registry";

/** May this viewer open the section at `href` (staff-only, desk switch, closed for the stage)? Unknown paths are open. */
export function useCanOpenSection(): (href: string) => boolean {
  const { isCurator, permissions } = useAuth();
  const nav = permissions.nav;
  return useCallback((href: string) => {
    const item = ALL_NAV_ITEMS.find((i) => i.href === href);
    return !item || navItemOpen(item, isCurator, nav);
  }, [isCurator, nav]);
}

export function HelpAccess({ children }: { children: ReactNode }) {
  const { isCurator, permissions } = useAuth();
  const canOpen = useCanOpenSection();
  const viewer = useMemo<HelpViewer>(() => ({ isCurator, tier: permissions.tier ?? null, canOpen }), [isCurator, permissions.tier, canOpen]);
  return <HelpAccessProvider value={viewer}>{children}</HelpAccessProvider>;
}

/** The page header's «?»: the help entry of the nav item that owns this URL (none for a path outside the nav). */
function PageHelp() {
  const [location] = useLocation();
  const item = navItemFor(location);
  if (!item || !isHelpId(item.key)) return null;
  return <ToolHelp id={item.key} size="md" />;
}

registerPageHelp(PageHelp);
