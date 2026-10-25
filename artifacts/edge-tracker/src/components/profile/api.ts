/**
 * «Профиль» — GET /api/profile/me and /api/profile/:id (api routes/profile.ts, lib/profile/*). One query per person;
 * the server sends codes + numbers, every sentence is built in model.ts. 403 PERSONAL_DATA_FORBIDDEN = the denied view.
 */
import { queryOptions } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import type { EdgeMapView } from "@/components/shared/edge-map/api";

export const ATTR_KEYS = ["discipline", "risk", "stability", "edge", "patience", "execution", "recovery", "growth"] as const;
export type AttrKey = (typeof ATTR_KEYS)[number];

export type AttrBasis =
  | "violations" | "noRules" | "limits" | "tail" | "days" | "bootstrap" | "shrunk" | "frequency" | "giveback" | "afterLoss" | "trend";

export type Attribute = {
  key: AttrKey;
  score: number | null;
  sample: number;
  minSample: number;
  unit: "days" | "trades" | "pairs";
  low: boolean;
  basis: AttrBasis;
  inputs: Record<string, number | null>;
  deskMedian: number | null;
};

export type Archetype = "newcomer" | "scalper" | "daytrader" | "swing" | "mixed";
export type ProfileSummary = { archetype: Archetype; top: AttrKey[]; weak: AttrKey | null; lowData: boolean };

export type TimelineKind =
  | "joined" | "first_trade" | "milestone_trades" | "stage_change" | "readiness" | "achievement"
  | "best_day" | "best_week" | "best_month" | "first_green_month" | "drawdown" | "recovery"
  | "rule_adopted" | "intervention";
export type TimelineEvent = { kind: TimelineKind; day: string; params: Record<string, string | number | null> };
export type Era = { month: string; trades: number; net: number; activeDays: number; winRate: number | null };

export type Slice = { key: string; n: number; net: number; winRate: number | null };
export type SliceSet = { best: Slice[]; worst: Slice[] };

export const PRICE_BUCKETS = ["lt5", "5to20", "20to100", "gt100"] as const;
export const HOLD_BUCKETS = ["lt1m", "1to5m", "5to30m", "30mto2h", "gt2h", "multiday"] as const;
export type Style = {
  trades: number;
  horizon: { intraday: number; overnight: number; swing: number };
  side: { long: number; short: number };
  price: Record<(typeof PRICE_BUCKETS)[number], number>;
  hold: Record<(typeof HOLD_BUCKETS)[number], number>;
  medianHoldSec: number | null;
  tradesPerDay: number | null;
};

export type KeyStats = {
  net: number; trades: number; wins: number; losses: number; winRate: number | null; profitFactor: number | null;
  expectancy: number | null; avgWin: number | null; avgLoss: number | null; activeDays: number; greenDays: number;
  bestDay: number | null; worstDay: number | null; maxDrawdown: number;
};

export type ProfileResponse = {
  person: {
    id: number; name: string; nameLatin: string | null; role: string; stage: "junior" | "trader" | "senior" | null; stageSince: string | null;
    curator: string | null; mentor: string | null; joinedAt: string | null; firstTradeDay: string | null; lastTradeDay: string | null;
    accounts: string[]; self: boolean;
  };
  window: { from: string; to: string; days: number };
  streak: { current: number; best: number };
  achievements: { line: string; tier: "bronze" | "silver" | "gold" | "platinum"; day: string; category: string }[];
  summary: ProfileSummary;
  attributes: Attribute[];
  stats: KeyStats;
  equity: { day: string; net: number; cum: number }[];
  calendar: { day: string; net: number; trades: number }[];
  slices: { setups: SliceSet; tickers: SliceSet; windows: SliceSet };
  edge: EdgeMapView | null;
  style: Style;
  timeline: { eras: Era[]; events: TimelineEvent[] };
  peer: { id: number | null; name: string; similarity: number } | null;
  quotes: { favs: string[]; theme: string };
  generatedAt: string;
};

/** "me" = the viewer; a number = users.id. */
export type ProfileRef = "me" | number;

export const profileKeys = { one: (ref: ProfileRef) => ["profile", ref] as const };

export const profileQuery = (ref: ProfileRef) =>
  queryOptions({
    queryKey: profileKeys.one(ref),
    queryFn: ({ signal }) => http.get<ProfileResponse>(`/api/profile/${ref === "me" ? "me" : String(ref)}`, { signal }),
    staleTime: STALE.long,
    // The server sends codes and numbers only: a language switch needs no refetch.
    meta: { i18n: false },
  });
