import { Link } from "wouter";
import { CalendarClock } from "lucide-react";
import type { SeasonState } from "@/lib/gamification/types";
import { cn } from "@/lib/utils";
import { gamificationI18n } from "@/i18n/ns/gamification";
import { seasonBarText } from "./gamification-labels";

/**
 * One line «Сезон октября: 84 очка · 7-е место · 12 дней до конца» — in the dashboard rewards block and on top of the
 * «Квесты и достижения» tab. With `href` it links to the season ranking (/ratings?tab=season).
 */
export function SeasonBar({ season, href, className }: { season: SeasonState | null | undefined; href?: string; className?: string }) {
  const { t } = gamificationI18n.useT();
  if (!season) return null;
  const text = seasonBarText(season);
  const body = (
    <>
      <CalendarClock className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 tabular-nums">{text}</span>
    </>
  );
  const cls = cn("inline-flex min-h-7 min-w-0 items-center gap-1.5 self-start rounded-lg text-xs text-foreground", className);
  if (!href) return <p className={cls} aria-label={t("season.aria")}>{body}</p>;
  return (
    <Link href={href} className={cn(cls, "px-1 -mx-1 hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")} title={t("season.link")}>
      {body}
    </Link>
  );
}

/** A title next to a name in rankings: small, quiet, never louder than the name. */
export function TitleTag({ label, className }: { label: string | null | undefined; className?: string }) {
  if (!label) return null;
  // Shrinks before the name does (narrow podium cards on phones), truncating with a tooltip.
  return <span title={label} className={cn("min-w-0 max-w-[10rem] shrink-[3] truncate rounded-full bg-primary/10 px-1.5 py-px text-2xs font-medium text-primary", className)}>{label}</span>;
}
