import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { apiUrl } from "@/lib/api";

export type CallType = "BMO" | "AMC" | "TNS";

export type EarningsItem = {
  ticker: string;
  company: string;
  callType: CallType;
  epsActual: number | null;
  epsEstimate: number | null;
  epsSurprisePct: number | null;
  marketCap?: string | null;
  marketCapNum?: number | null;
  fiscalQuarter?: string | null;
  noOfEsts?: number | null;
  lastYearEps?: number | null;
  lastYearDate?: string | null;
  price: number | null;
  priceMoveDay: number | null;
  pricePreMarket: number | null;
  pricePostMarket: number | null;
  volume: number | null;
  avgVolume: number | null;
  relVol: number | null;
};

export type EarningsWatchData = {
  date: string;
  amcDate: string;
  bmo: EarningsItem[];
  amc: EarningsItem[];
  fetchedAt?: string;
  refreshed?: boolean;
  throttled?: boolean;
  nextRefreshAt?: string;
};

export type UpcomingItem = Pick<
  EarningsItem,
  "ticker" | "company" | "callType" | "epsEstimate" | "marketCap" | "marketCapNum" | "fiscalQuarter" | "noOfEsts" | "lastYearEps" | "lastYearDate"
>;

export type UpcomingData = {
  today: string;
  days: { date: string; total: number; items: UpcomingItem[] }[];
  fetchedAt: string;
};

export type HistoryQuarter = {
  fiscalQuarter: string | null;
  date: string;
  epsActual: number | null;
  epsEstimate: number | null;
  surprisePct: number | null;
  beat: boolean | null;
  reactionDate: string | null;
  gapPct: number | null;
  dayPct: number | null;
  closePct: number | null;
  rangePct: number | null;
};

export type EarningsHistory = {
  ticker: string;
  timing: CallType | null;
  quarters: HistoryQuarter[];
  streak: { kind: "beat" | "miss" | null; count: number };
  beats: number;
  misses: number;
  avgAbsGap: number | null;
  avgAbsClose: number | null;
  upReactions: number;
  downReactions: number;
  fetchedAt: string;
};

async function getJson<T>(path: string): Promise<T> {
  const resp = await fetch(apiUrl(path));
  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    try {
      const j = await resp.json();
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return resp.json() as Promise<T>;
}

export const EARNINGS_WATCH_KEY = ["earnings", "watch"] as const;
export const EARNINGS_UPCOMING_KEY = ["earnings", "upcoming", 5] as const;

export function useEarningsWatch(enabled = true) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: EARNINGS_WATCH_KEY,
    queryFn: () => getJson<EarningsWatchData>("/api/earnings/watch"),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
  const [refreshing, setRefreshing] = useState(false);
  /** Bypasses the server cache (?refresh=1). Server rate-limits to one forced refresh per minute. */
  const refresh = useCallback(async (): Promise<{ throttled: boolean; nextRefreshAt?: string }> => {
    setRefreshing(true);
    try {
      const data = await getJson<EarningsWatchData>("/api/earnings/watch?refresh=1");
      qc.setQueryData(EARNINGS_WATCH_KEY, data);
      return { throttled: !!data.throttled, nextRefreshAt: data.nextRefreshAt };
    } finally {
      setRefreshing(false);
    }
  }, [qc]);
  return { ...query, refresh, refreshing };
}

export function useEarningsUpcoming(enabled = true) {
  return useQuery({
    queryKey: EARNINGS_UPCOMING_KEY,
    queryFn: () => getJson<UpcomingData>("/api/earnings/upcoming?days=5&limit=25"),
    staleTime: 15 * 60 * 1000,
    enabled,
  });
}

export function useEarningsHistory(ticker: string | null | undefined, timing?: CallType | null) {
  const t = (ticker ?? "").trim().toUpperCase();
  const tm = timing === "BMO" || timing === "AMC" ? timing : "";
  return useQuery({
    queryKey: ["earnings", "history", t, tm],
    queryFn: () => getJson<EarningsHistory>(`/api/earnings/history/${encodeURIComponent(t)}${tm ? `?timing=${tm}` : ""}`),
    enabled: /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
}

// ── formatting helpers shared by earnings + research UI ──
export function fmtPct(n: number | null | undefined, digits = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(digits)}%`;
}

export function fmtMoney(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;
}

export function fmtCompact(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(Math.round(n));
}

export function fmtShortDate(iso: string | null | undefined, withWeekday = false) {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    ...(withWeekday ? { weekday: "short" } : {}),
    timeZone: "UTC",
  });
}

export function relTime(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "только что";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч назад`;
  return `${Math.round(h / 24)} дн назад`;
}

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
