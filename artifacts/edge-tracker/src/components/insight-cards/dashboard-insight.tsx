/**
 * One insight card as a dashboard block (pages/dashboard: «streaks», «seqDay», «holdTime», «weekdays», «afterLoss»).
 * The dashboard shows them on «Мои» only — a team-wide streak or «after a loss» mixes different people's trades into
 * one sequence, and the team mode has no trader picker; staff see any one trader's cards on /stats.
 * Data: the viewer's own trades of the last 90 days (the /stats «90 дней» window, so the cache is shared); a click
 * opens /stats on the same window with the slice checked in «Разрезы».
 */
import { CalendarDays, Hourglass, ListOrdered, RotateCcw, Zap, type LucideIcon } from "lucide-react";
import { insightCardsI18n } from "@/i18n/ns/insightCards";
import { AfterLossCard, HoldCard, SeqCard, WeekdayCard } from "./cards";
import { CardSkeleton, type InsightScope } from "./kit";
import type { InsightTrade } from "./model";
import { StreaksCard } from "./streaks-card";

export type InsightSectionId = "streaks" | "seqDay" | "holdTime" | "weekdays" | "afterLoss";

const META: Record<InsightSectionId, { icon: LucideIcon; title: () => string }> = {
  streaks: { icon: Zap, title: () => insightCardsI18n.t("streaks.title") },
  seqDay: { icon: ListOrdered, title: () => insightCardsI18n.t("seq.title") },
  holdTime: { icon: Hourglass, title: () => insightCardsI18n.t("holdTime.title") },
  weekdays: { icon: CalendarDays, title: () => insightCardsI18n.t("weekday.title") },
  afterLoss: { icon: RotateCcw, title: () => insightCardsI18n.t("afterLoss.title") },
};

export function DashboardInsight({
  id,
  trades,
  isLoading,
  scope,
}: {
  id: InsightSectionId;
  trades: readonly InsightTrade[] | undefined;
  isLoading: boolean;
  scope: InsightScope;
}) {
  insightCardsI18n.useT(); // re-render on a language switch (titles of the skeleton)
  if (!trades) return isLoading ? <CardSkeleton icon={META[id].icon} title={META[id].title()} /> : null;
  switch (id) {
    case "streaks":
      return <StreaksCard trades={trades} scope={scope} />;
    case "seqDay":
      return <SeqCard trades={trades} scope={scope} />;
    case "holdTime":
      return <HoldCard trades={trades} scope={scope} />;
    case "weekdays":
      return <WeekdayCard trades={trades} scope={scope} />;
    case "afterLoss":
      return <AfterLossCard trades={trades} scope={scope} />;
  }
}
