/** Live (PropReports positions tick) shapes of the risk API — re-exported from use-risk.ts. */
/**
 * PropReports open-positions snapshot behind today's numbers (positions tick, every 5 min in the session). `counted` =
 * fresh: its unrealized is inside today.pnlNet / the stop; a stale one is shown, never counted. Absent on older servers.
 */
export type RiskLive = {
  date: string;
  unrealizedUsd: number;
  openPositions: number;
  fetchedAt: string;
  ageMin: number;
  counted: boolean;
};

export type LivePosition = { account: string; symbol: string; qty: number; avg: number | null; close: number | null; unrealized: number };

/** Desk-level snapshot freshness (GET /api/risk/desk `live`). */
export type DeskLive = {
  traders: number;
  counted: number;
  stale: number;
  openPositions: number;
  unrealizedUsd: number;
  fetchedAt: string;
  ageMin: number;
};
