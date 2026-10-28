/**
 * Desk pulse on the client (GET /api/desk-pulse, api lib/deskPulse). Every number comes from the api: desk-level
 * aggregates of PropReports trades by setup family × timing; nothing is computed here. The key starts with the trades
 * domain, so a sync that writes trades refreshes it.
 */
import { queryOptions } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import { timingLabel, type Timing } from "@/components/shared/session-flow/timing";
import { deskPulseI18n } from "@/i18n/ns/deskPulse";

export const FAMILIES = ["gap_up_long", "gap_up_short", "gap_down_long", "gap_down_short", "flat_long", "flat_short"] as const;
export type Family = (typeof FAMILIES)[number];
export const isFamily = (v: unknown): v is Family => typeof v === "string" && (FAMILIES as readonly string[]).includes(v);

export const familyLabel = (f: string): string => (isFamily(f) ? deskPulseI18n.t(`family.${f}`) : f);

export type PulseVerdict = "works" | "fails" | "mixed";
export type PulseCell = {
  family: Family;
  timing: Timing;
  n: number;
  traders: number | null;
  winrate: number | null;
  net: number | null;
  netExTop3: number | null;
  median: number | null;
  medianR: number | null;
  rTrades: number;
  outliers: boolean;
  thin: "trades" | "people" | null;
  verdict: PulseVerdict | null;
};
export type PulseHighlight = { family: Family; timing: Timing; n: number };
export type DeskPulse = {
  from: string;
  to: string;
  windowDays: number;
  minTrades: number;
  minTraders: number;
  cells: PulseCell[];
  trades: number;
  unclassified: number;
  traders: number;
  works: PulseHighlight | null;
  fails: PulseHighlight | null;
  staff: boolean;
};

export const deskPulseQuery = () => queryOptions({
  queryKey: ["trades", "desk-pulse"] as const,
  queryFn: ({ signal }) => http.get<DeskPulse>("/api/desk-pulse", { signal }),
  staleTime: STALE.long,
});

/** «Gap up — short · After-market» */
export const cellName = (c: { family: string; timing: string }): string =>
  deskPulseI18n.t("pulse.cellName", { family: familyLabel(c.family), timing: timingLabel(c.timing) });

/** The one line «this season: X works; Y does not» (null when neither side has a judged cell). */
export function pulseLine(p: { works: PulseHighlight | null; fails: PulseHighlight | null } | null | undefined): string | null {
  if (!p || (!p.works && !p.fails)) return null;
  const t = deskPulseI18n.t;
  if (p.works && p.fails) return t("pulse.line", { works: cellName(p.works), fails: cellName(p.fails) });
  return p.works ? t("pulse.lineWorks", { works: cellName(p.works) }) : t("pulse.lineFails", { fails: cellName(p.fails!) });
}
