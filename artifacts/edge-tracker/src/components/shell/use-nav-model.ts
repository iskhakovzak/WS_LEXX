/**
 * The viewer's menu: the full nav for the role, and — for traders within the desk setting — the simple menu
 * (nav-model.ts). Until GET /api/permissions/me answers, the last mode seen for this user is used (no flash).
 */
import React from "react";
import { useAuth } from "@/contexts/auth-context";
import { isSimpleNav, simpleNav, visibleNav, type SimpleNav, type VisibleGroup } from "./nav-model";
import { readSimpleMode, writeSimpleMode } from "./use-nav-prefs";

/** Full menu for the current role (staff-only pages filtered, hidden ones dropped). */
export function useVisibleNav(): VisibleGroup[] {
  const { isCurator } = useAuth();
  return React.useMemo(() => visibleNav(isCurator), [isCurator]);
}

export function useNavModel(): { groups: VisibleGroup[]; simple: SimpleNav | null } {
  const { user, permissions, permissionsLoaded } = useAuth();
  const groups = useVisibleNav();
  const name = user?.traderName ?? null;
  const loaded = permissionsLoaded && permissions.tier !== undefined;
  const on = loaded
    ? isSimpleNav({ role: user?.role, tier: permissions.tier, prefs: permissions.nav })
    : user?.role === "trader" && readSimpleMode(name) === true;
  React.useEffect(() => {
    if (loaded && name) writeSimpleMode(name, on);
  }, [loaded, name, on]);
  const prefs = permissions.nav;
  const simple = React.useMemo(() => (on ? simpleNav(groups, prefs) : null), [on, groups, prefs]);
  return { groups, simple };
}
