/**
 * The insight bento: tiles of mixed sizes on one responsive grid (12 columns on wide screens, 6 on tablets, one column on
 * phones) — /stats shows every tile except «Сегодня» for the selected period / trader / «Разрезы». `prev` is the previous
 * equal period (trend chips); while it loads the tiles simply have no trend yet. The dashboard places each tile on its
 * own grid (components/dashboard board) through `InsightTileCard`, with the content layout of its packed size.
 */
import { Skeleton } from "@/components/ui/skeleton";
import { commonI18n } from "@/i18n/ns/common";
import { insightTilesI18n } from "@/i18n/ns/insightTiles";
import { type TileSize, type TileVariant } from "./kit";
import { LeaksTile } from "./tile-leaks";
import { StreakTile } from "./tile-streak";
import { AfterTile, HoldTile, SeqTile } from "./tiles-behaviour";
import { FeesTile, TodayTile, WeekdayTile } from "./tiles-money";
import type { InsightScope } from "./nav";
import type { InsightTrade } from "./model";
import "./insight-tiles.css";

export type TileId = "streaks" | "leaks" | "seqDay" | "afterLoss" | "holdTime" | "weekdays" | "fees" | "todayTile";

/** Every tile in the default order. */
export const TILE_IDS: readonly TileId[] = ["streaks", "leaks", "seqDay", "afterLoss", "holdTime", "weekdays", "fees", "todayTile"];

export const TILE_SIZE: Record<TileId, TileSize> = {
  streaks: "hero",
  leaks: "wide",
  seqDay: "third",
  afterLoss: "third",
  holdTime: "third",
  weekdays: "half",
  fees: "third",
  todayTile: "quarter",
};

export type TodayLive = { date: string; net: number | null | undefined };

function TileSkeleton({ id, variant }: { id: TileId; variant?: TileVariant }) {
  return (
    <div data-size={TILE_SIZE[id]} data-variant={variant} className="ins-tile glass-panel" role="status" aria-label={commonI18n.t("states.loading")}>
      <Skeleton className="h-3 w-28 rounded" />
      <Skeleton className="h-16 w-1/2 rounded-xl" />
      <Skeleton className="h-4 w-3/4 rounded" />
      {variant !== "s" && <Skeleton className="mt-auto h-12 w-full rounded-xl" />}
    </div>
  );
}

type TileData = { trades: readonly InsightTrade[]; prev?: readonly InsightTrade[] | null; scope: InsightScope; today?: TodayLive | null; variant?: TileVariant };

function TileOf({ id, trades, prev, scope, today, variant }: TileData & { id: TileId }) {
  switch (id) {
    case "streaks": return <StreakTile trades={trades} scope={scope} variant={variant} />;
    case "leaks": return <LeaksTile trades={trades} prev={prev} scope={scope} variant={variant} />;
    case "seqDay": return <SeqTile trades={trades} prev={prev} scope={scope} variant={variant} />;
    case "afterLoss": return <AfterTile trades={trades} prev={prev} scope={scope} variant={variant} />;
    case "holdTime": return <HoldTile trades={trades} prev={prev} scope={scope} variant={variant} />;
    case "weekdays": return <WeekdayTile trades={trades} prev={prev} scope={scope} variant={variant} />;
    case "fees": return <FeesTile trades={trades} prev={prev} scope={scope} variant={variant} />;
    case "todayTile": return today ? <TodayTile trades={trades} today={today.date} liveNet={today.net} scope={scope} /> : null;
  }
}

/** One insight tile at a dashboard content layout (loading → its skeleton). */
export function InsightTileCard({
  id,
  variant,
  trades,
  prev,
  isLoading,
  scope,
}: {
  id: TileId;
  variant: TileVariant;
  trades: readonly InsightTrade[] | undefined;
  prev?: readonly InsightTrade[] | null;
  isLoading?: boolean;
  scope: InsightScope;
}) {
  insightTilesI18n.useT(); // re-render on a language switch
  if (trades) return <TileOf id={id} trades={trades} prev={prev} scope={scope} variant={variant} />;
  return isLoading ? <TileSkeleton id={id} variant={variant} /> : null;
}

export function InsightBento({
  ids = TILE_IDS,
  trades,
  prev,
  isLoading,
  scope,
  today,
}: {
  ids?: readonly TileId[];
  trades: readonly InsightTrade[] | undefined;
  prev?: readonly InsightTrade[] | null;
  isLoading?: boolean;
  scope: InsightScope;
  today?: TodayLive | null;
}) {
  insightTilesI18n.useT(); // re-render on a language switch
  const shown = ids.filter((id) => id !== "todayTile" || !!today);
  if (!shown.length) return null;
  return (
    <div className="ins-bento" data-fill={shown[shown.length - 1] === "fees" && !shown.includes("todayTile") ? "last" : undefined}>
      {shown.map((id) =>
        trades ? (
          <TileOf key={id} id={id} trades={trades} prev={prev} scope={scope} today={today} />
        ) : isLoading ? (
          <TileSkeleton key={id} id={id} />
        ) : null,
      )}
    </div>
  );
}
