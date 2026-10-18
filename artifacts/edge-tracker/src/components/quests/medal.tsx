/**
 * Achievement medal: the line's category icon in a round tile, tinted by the highest earned tier (design tokens
 * --medal-bronze/silver/gold/platinum in index.css); locked lines stay neutral, hidden secrets show a lock.
 */
import type { LucideIcon } from "lucide-react";
import { CalendarCheck, ClipboardCheck, Crosshair, GraduationCap, Lock, ShieldCheck, Sprout, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AchievementCategory, AchievementTier } from "@/lib/quests/types";

export const CATEGORY_ICON: Readonly<Record<AchievementCategory, LucideIcon>> = {
  discipline: ShieldCheck,
  review: ClipboardCheck,
  focus: Crosshair,
  risk: Wallet,
  planning: CalendarCheck,
  learning: GraduationCap,
  growth: Sprout,
};

/** Text / tinted fill / ring per tier — Tailwind classes over the medal tokens (no raw colours). */
export const TIER_TONE: Readonly<Record<AchievementTier, { text: string; fill: string; ring: string; bar: string }>> = {
  bronze: { text: "text-medal-bronze", fill: "bg-medal-bronze/15", ring: "ring-medal-bronze/40", bar: "bg-medal-bronze" },
  silver: { text: "text-medal-silver", fill: "bg-medal-silver/15", ring: "ring-medal-silver/40", bar: "bg-medal-silver" },
  gold: { text: "text-medal-gold", fill: "bg-medal-gold/15", ring: "ring-medal-gold/40", bar: "bg-medal-gold" },
  platinum: { text: "text-medal-platinum", fill: "bg-medal-platinum/15", ring: "ring-medal-platinum/45", bar: "bg-medal-platinum" },
};

export function Medal({
  category,
  tier,
  hidden = false,
  size = "md",
  className,
}: {
  category: AchievementCategory;
  tier: AchievementTier | null;
  hidden?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const Icon = hidden ? Lock : CATEGORY_ICON[category] ?? ShieldCheck;
  const tone = tier ? TIER_TONE[tier] : null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full",
        size === "sm" ? "h-6 w-6 [&_svg]:size-3.5" : size === "lg" ? "h-11 w-11 [&_svg]:size-5.5" : "h-9 w-9 [&_svg]:size-4.5",
        tone ? cn(tone.fill, tone.text, "ring-2 ring-inset", tone.ring) : "bg-foreground/[0.06] text-muted-foreground/70",
        className,
      )}
    >
      <Icon />
    </span>
  );
}

/** A small tier dot (earned = filled in the tier colour, locked = outline). */
export function TierDot({ tier, earned }: { tier: AchievementTier; earned: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", earned ? TIER_TONE[tier].bar : "border border-muted-foreground/40")}
    />
  );
}
