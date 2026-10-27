/**
 * The period of /office in the URL (design audit wave 3). /office is a calendar-anchored year report — it does not
 * share the rolling scope of the analytics group (hooks/use-analytics-scope): a year (from 1 January), one of its
 * quarters Q1–Q4, one of its months, or «Период…».
 *
 *   ?period=ytd|quarter|month|custom (&from=&to=)  ?q=1..4  ?m=1..12  ?years=2025,2026
 *
 * Read on load (the URL wins), written with history.replaceState (other params stay). The old device keys
 * (usePersistentState «office-stats.years» / «.period» / «.custom», stored as `ws_lexx.<key>`) stay the fallback and
 * keep being written, so a bare /office opens on the last choice.
 */
import * as React from "react";
import { parseDayRange, type DayRange } from "@/lib/period-range";

export type OfficePreset = "ytd" | "quarter" | "month";
export type OfficeMode = OfficePreset | "custom";

export type OfficeUrl = { mode: OfficeMode | null; custom: DayRange | null; q: number | null; m: number | null; years: number[] | null };

const intIn = (v: string | null, lo: number, hi: number): number | null => {
  if (v == null || !/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= lo && n <= hi ? n : null;
};

/** The /office params of a URL search (pure). `period=year` (the vocabulary word) reads as the year. */
export function readOfficeUrl(search: string): OfficeUrl {
  const sp = new URLSearchParams(search);
  const custom = parseDayRange(sp.get("from"), sp.get("to"));
  const p = sp.get("period");
  const mode: OfficeMode | null = p === "ytd" || p === "year" ? "ytd" : p === "quarter" || p === "month" ? p : p === "custom" && custom ? "custom" : null;
  const years = (sp.get("years") ?? "").split(",").map((y) => intIn(y.trim(), 2000, 2100)).filter((y): y is number => y != null);
  return { mode, custom, q: intIn(sp.get("q"), 1, 4), m: intIn(sp.get("m"), 1, 12), years: years.length ? [...new Set(years)].sort((a, b) => a - b) : null };
}

/** Writes the period into the URL (replaceState; other params stay). */
export function writeOfficeUrl(s: { mode: OfficeMode; custom: DayRange | null; q: number; m: number; years: number[] }) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const sp = url.searchParams;
  sp.set("period", s.mode);
  if (s.mode === "custom" && s.custom) { sp.set("from", s.custom.from); sp.set("to", s.custom.to); } else { sp.delete("from"); sp.delete("to"); }
  if (s.mode === "quarter") sp.set("q", String(s.q)); else sp.delete("q");
  if (s.mode === "month") sp.set("m", String(s.m)); else sp.delete("m");
  sp.set("years", s.years.join(","));
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", next);
}

/** usePersistentState's storage (`ws_lexx.<key>`, JSON) with an initial value that wins over it (the URL's). */
export function useStoredState<T>(key: string, fromUrl: T | null, fallback: T) {
  const storageKey = `ws_lexx.${key}`;
  const [value, setValue] = React.useState<T>(() => {
    if (fromUrl != null) return fromUrl;
    try {
      const raw = localStorage.getItem(storageKey);
      return raw == null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  });
  React.useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* storage blocked — memory only */ }
  }, [storageKey, value]);
  return [value, setValue] as const;
}
