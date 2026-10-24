/**
 * The insight bento: tiles of mixed sizes on one responsive grid (12 columns on wide screens, 6 on tablets, one column on
 * phones). The dashboard passes the visible tile ids in the viewer's order (show / hide / reorder in «Настроить»);
 * /stats shows every tile except «Сегодня» for the selected period / trader / «Разрезы». `prev` is the previous equal
 * period (trend chips); while it loads the tiles simply have no trend yet.
 */
import { Skeleton } from "@/components/ui/skeleton";
import { commonI18n } from "@/i18n/ns/common";
import { insightTilesI18n } from "@/i18n/ns/insightTiles";
import { type TileSize } from "./kit";
import { LeaksTile } from "./tile-leaks";
import { StreakTile } from "./tile-streak";
import { AfterTile, HoldTile, SeqTile } from "./tiles-behaviour";
import { FeesTile, TodayTile, WeekdayTile } from "./tiles-money";
import type { InsightScope } from "./nav";
import type { InsightTrade } from "./model";
import "./insight-tiles.css";

export type TileId = "streaks" | "leaks" | "seqDay" | "afterLoss" | "holdTime" | "weekdays" | "fees" | "todayTile";

/** Every tile in the default order (the dashboard's DEFAULT_ORDER lists them in the same order). */
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

function TileSkeleton({ id }: { id: TileId }) {
  return (
    <div data-size={TILE_SIZE[id]} className="ins-tile glass-panel" role="status" aria-label={commonI18n.t("states.loading")}>
      <Skeleton className="h-3 w-28 rounded" />
      <Skeleton className="h-16 w-1/2 rounded-xl" />
      <Skeleton className="h-4 w-3/4 rounded" />
      <Skeleton className="mt-auto h-12 w-full rounded-xl" />
    </div>
  );
}

function TileOf({ id, trades, prev, scope, today }: { id: TileId; trades: readonly InsightTrade[]; prev?: readonly InsightTrade[] | null; scope: InsightScope; today?: TodayLive | null }) {
  switch (id) {
    case "streaks": return <StreakTile trades={trades} scope={scope} />;
    case "leaks": return <LeaksTile trades={trades} prev={prev} scope={scope} />;
    case "seqDay": return <SeqTile trades={trades} prev={prev} scope={scope} />;
    case "afterLoss": return <AfterTile trades={trades} prev={prev} scope={scope} />;
    case "holdTime": return <HoldTile trades={trades} prev={prev} scope={scope} />;
    case "weekdays": return <WeekdayTile trades={trades} prev={prev} scope={scope} />;
    case "fees": return <FeesTile trades={trades} prev={prev} scope={scope} />;
    case "todayTile": return today ? <TodayTile trades={trades} today={today.date} liveNet={today.net} scope={scope} /> : null;
  }
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
