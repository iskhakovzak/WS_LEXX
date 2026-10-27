/**
 * The period of /analyst-actions in the URL (design audit wave 3: `?period=<value>`, `&from=&to=` for «Период…»), so a
 * link opens the same window. The page keeps its persisted filters (analyst.filters.v6) as the fallback: a link wins
 * on load, then every change is written back with history.replaceState (other params kept; the default is omitted).
 */
import * as React from "react";
import { parseDayRange, type DayRange } from "@/lib/period-range";

export type UrlPeriod<P extends string> = { period: P; custom?: DayRange };

/** `?period` (+ from/to) read through the page's own normalizer; null when absent or not usable. */
export function readUrlPeriod<P extends string>(normalize: (v: string) => P | null): UrlPeriod<P> | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  const raw = q.get("period");
  if (!raw) return null;
  if (raw === "custom") {
    const custom = parseDayRange(q.get("from"), q.get("to"));
    const p = normalize("custom");
    return custom && p ? { period: p, custom } : null;
  }
  const p = normalize(raw);
  return p ? { period: p } : null;
}

export function writeUrlPeriod(period: string, custom: DayRange | null, fallback: string) {
  if (typeof window === "undefined") return;
  const q = new URLSearchParams(window.location.search);
  if (period === fallback) q.delete("period");
  else q.set("period", period);
  if (period === "custom" && custom) { q.set("from", custom.from); q.set("to", custom.to); }
  else { q.delete("from"); q.delete("to"); }
  const qs = q.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(window.history.state, "", next);
  }
}

/**
 * Merge a linked period into persisted state: returns the link's value for the first render (so the first fetch
 * already uses it), applies it to the store once, then mirrors every change of `period` / `custom` into the URL.
 */
export function useUrlPeriod<P extends string>({
  normalize, period, custom, fallback, apply,
}: {
  normalize: (v: string) => P | null;
  period: P;
  custom: DayRange | null;
  fallback: P;
  apply: (v: UrlPeriod<P>) => void;
}): UrlPeriod<P> | null {
  const pending = React.useRef<UrlPeriod<P> | null | undefined>(undefined);
  if (pending.current === undefined) pending.current = readUrlPeriod(normalize);
  const skipWrite = React.useRef(!!pending.current);
  React.useEffect(() => {
    const v = pending.current;
    pending.current = null;
    if (v) apply(v);
    // once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  React.useEffect(() => {
    // The first pass still holds the stored value while the link is being applied: keep the link in the URL.
    if (skipWrite.current) { skipWrite.current = false; return; }
    writeUrlPeriod(period, custom, fallback);
  }, [period, custom, fallback]);
  return pending.current;
}
