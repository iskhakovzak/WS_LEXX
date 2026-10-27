/**
 * «Рекомендации офису» data layer: GET /api/office-stats/recommendations (mirrors api lib/officeRecs/types) and the
 * «скрыть на неделю» write — the viewer's own users.settings.officeRecsHidden via PUT /api/users/me/settings.
 * The server already redacted the answer for this viewer ($ and names only where allowed).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import { addDaysYmd } from "./pulse";

export type RecKind = "leak" | "rule" | "fees" | "crowding" | "practice" | "attention" | "readiness" | "regime";
export type Interval = { mean: number; lo: number; hi: number };
export type RecAction = { kind: "whatif" | "rules" | "curator" | "academy" | "risk" | "benchmark" | "myReview" | "trades"; href: string };

export type OfficeRec = {
  id: string;
  kind: RecKind;
  audience: "desk" | "staff";
  priority: number;
  confidence: 1 | 2 | 3;
  params: Record<string, string | number | null>;
  money: (Interval & { per: "trade" | "day" | "traderDay" }) | null;
  rel: (Interval & { unit: "bps" | "share" }) | null;
  affected: { count: number; names: string[] };
  action: RecAction | null;
  secondary: RecAction | null;
  basis: { trades: number; days: number; traders: number; from: string; to: string; q: number | null };
};

export type HiddenRec = { id: string; until: string; kind: RecKind };

export type RecsResponse = {
  role: "admin" | "curator" | "trader";
  asOf: string;
  computedAt: string;
  window: { from: string; to: string; days: number };
  recs: OfficeRec[];
  hidden: HiddenRec[];
};

const KEY = ["office-recs"] as const;
export const HIDE_DAYS = 7;

export function useOfficeRecs(enabled = true) {
  return useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => http.get<RecsResponse>("/api/office-stats/recommendations", { signal }),
    enabled,
    staleTime: STALE.short,
  });
}

/** The full hidden map after hiding / restoring one id (the server keeps only what is sent). */
export function nextHiddenMap(hidden: readonly HiddenRec[], change: { hide?: string; show?: string | "all" }, today: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (change.show !== "all") for (const h of hidden) if (h.id !== change.show) out[h.id] = h.until;
  if (change.hide) out[change.hide] = addDaysYmd(today, HIDE_DAYS);
  return out;
}

export function useHideRec() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (map: Record<string, string>) => http.put("/api/users/me/settings", { officeRecsHidden: Object.keys(map).length ? map : null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
