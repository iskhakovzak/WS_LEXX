/**
 * Glue between the shell's navigation model and the onboarding feature (features never import each other): which
 * sections this viewer can open (stage-blocked and staff-only ones leave the tour and the hint list) and the «G then
 * letter» shortcuts for «Помощь». Mounted once by components/layout.tsx.
 */
import { useCallback, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import { ALL_NAV_ITEMS } from "@/components/shell/nav";
import { navItemOpen } from "@/components/shell/nav-model";
import { OnboardingHost } from "@/components/onboarding/onboarding-host";

export function OnboardingMount() {
  const { isCurator, permissions } = useAuth();
  const nav = permissions.nav;
  const canOpen = useCallback((href: string) => {
    const item = ALL_NAV_ITEMS.find((i) => i.href === href);
    return !item || navItemOpen(item, isCurator, nav);
  }, [isCurator, nav]);
  const goKeys = useMemo(
    () => ALL_NAV_ITEMS.filter((i) => i.goKey && !i.hidden && navItemOpen(i, isCurator, nav)).map((i) => ({ key: i.goKey as string, label: i.name })),
    [isCurator, nav],
  );
  return <OnboardingHost canOpen={canOpen} goKeys={goKeys} />;
}
