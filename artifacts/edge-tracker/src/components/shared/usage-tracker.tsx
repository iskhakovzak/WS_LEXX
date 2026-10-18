/**
 * Usage tracking glue (lib/usage.ts): `UsageRouteTracker` sends a view per route change (mounted once in App's
 * router), `UsageMark` sends one action when it mounts (and again when its action / meta change) — for steps that are
 * a render branch rather than a click (a cheat sheet opened, «Сегодня» shown). Both render nothing.
 */
import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { trackAction, trackView, type UsageAction, type UsageMeta } from "@/lib/usage";

export function UsageRouteTracker() {
  const [location] = useLocation();
  const search = useSearch();
  useEffect(() => { trackView(location, search); }, [location, search]);
  return null;
}

export function UsageMark({ action, meta }: { action: UsageAction; meta?: UsageMeta }) {
  const code = meta?.code ?? null;
  const mode = meta?.mode;
  useEffect(() => { trackAction(action, code ? { code } : mode ? { mode } : undefined); }, [action, code, mode]);
  return null;
}
