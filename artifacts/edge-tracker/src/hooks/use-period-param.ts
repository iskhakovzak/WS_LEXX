/**
 * The period of a screen kept in the URL (design audit wave 3, BRIEF §2): `?period=<value>` (+ `&from=&to=` for
 * «Период…»), written with history.replaceState so other params stay; read on load (legacy values via
 * normalizePeriod: `7d`, `"30"`, `"90"`…). localStorage stays as the fallback for a bare URL, and an old storage key
 * (`legacyStorageKey`) or an old URL param (`legacyParam`, e.g. `gp`) is still read so a saved preference survives.
 */
import * as React from "react";
import { normalizePeriod, parseDayRange, type DayRange, type PeriodPreset, type PeriodValue } from "@/lib/period-range";
import { nyDate } from "@/lib/trading-date";

function readLs(key: string | undefined): string | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    // useStoredState / usePersistentState may have stored a JSON string.
    try {
      const v: unknown = JSON.parse(raw);
      return typeof v === "string" || typeof v === "number" ? String(v) : raw;
    } catch {
      return raw;
    }
  } catch {
    return null;
  }
}

function writeLs(key: string | undefined, v: string) {
  if (!key) return;
  try {
    localStorage.setItem(key, v);
  } catch {
    /* private mode */
  }
}

export type PeriodParam<P extends PeriodPreset = PeriodPreset> = {
  period: P | "custom";
  custom: DayRange | null;
  today: string;
  setPreset: (p: P) => void;
  setCustom: (r: DayRange) => void;
};

export function usePeriodParam<P extends PeriodPreset>({
  fallback,
  presets,
  param = "period",
  legacyParam,
  storageKey,
  legacyStorageKey,
  allowCustom = true,
  legacy,
}: {
  fallback: P;
  /** The presets the screen offers; any other stored value falls back. */
  presets: readonly P[];
  param?: string;
  /** An old URL key still read on load (and dropped from the URL on the first change). */
  legacyParam?: string;
  storageKey?: string;
  /** An old storage key read when `storageKey` is empty. */
  legacyStorageKey?: string;
  /** false: «Период…» is not accepted from the URL (the endpoint has no from/to). */
  allowCustom?: boolean;
  /** The value an older build stored in another shape («30», «90», «0»…), read last. */
  legacy?: () => unknown;
}): PeriodParam<P> {
  const today = nyDate();
  const [state, setState] = React.useState<{ period: P | "custom"; custom: DayRange | null }>(() => {
    const q = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
    const custom = parseDayRange(q.get("from"), q.get("to"));
    const ok = (v: PeriodValue): v is P | "custom" => (v === "custom" ? allowCustom && !!custom : (presets as readonly string[]).includes(v));
    const old = legacy?.();
    const candidates = [q.get(param), legacyParam ? q.get(legacyParam) : null, readLs(storageKey), readLs(legacyStorageKey), old == null ? null : String(old)];
    for (const c of candidates) {
      if (c == null || c === "") continue;
      const v = normalizePeriod(c, fallback);
      if (ok(v)) return { period: v, custom };
    }
    return { period: fallback, custom };
  });

  const write = React.useCallback(
    (period: P | "custom", custom: DayRange | null) => {
      if (typeof window === "undefined") return;
      const url = new URL(window.location.href);
      if (period === fallback) url.searchParams.delete(param);
      else url.searchParams.set(param, period);
      if (legacyParam) url.searchParams.delete(legacyParam);
      if (period === "custom" && custom) {
        url.searchParams.set("from", custom.from);
        url.searchParams.set("to", custom.to);
      } else {
        url.searchParams.delete("from");
        url.searchParams.delete("to");
      }
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      if (period !== "custom") writeLs(storageKey, period);
    },
    [fallback, param, legacyParam, storageKey],
  );

  const setPreset = React.useCallback(
    (p: P) => {
      setState((s) => ({ period: p, custom: s.custom }));
      write(p, null);
    },
    [write],
  );
  const setCustom = React.useCallback(
    (r: DayRange) => {
      setState({ period: "custom", custom: r });
      write("custom", r);
    },
    [write],
  );

  return { period: state.period, custom: state.custom, today, setPreset, setCustom };
}
