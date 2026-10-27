/**
 * Achievement medal: a struck «Олимп» coin (components/shared/medals) with the line's category emblem, minted in the
 * highest earned tier's metal; a line with nothing earned is a blank coin, a hidden secret shows «?».
 * Tier text / bar tones stay on the design tokens --medal-bronze/silver/gold/platinum (index.css).
 */
import { AwardCoin, type EmblemKey } from "@/components/shared/medals";
import { cn } from "@/lib/utils";
import type { AchievementCategory, AchievementTier } from "@/lib/quests/types";

/** One Greek emblem per category: discipline = hoplite shield, review = scroll, focus = Artemis' bow, risk = the scales
 *  of Themis, planning = temple, learning = oil lamp, growth = olive sprig; v2: records = torch, leaks = a sealed amphora,
 *  mastery = helmet, social = Athena's owl. */
export const CATEGORY_EMBLEM: Readonly<Record<AchievementCategory, EmblemKey>> = {
  discipline: "shield",
  review: "scroll",
  focus: "bow",
  risk: "scales",
  planning: "temple",
  learning: "lamp",
  growth: "sprig",
  records: "torch",
  leaks: "amphora",
  mastery: "helmet",
  social: "owl",
};

/** Text / tinted fill / ring per tier — Tailwind classes over the medal tokens (no raw colours). */
export const TIER_TONE: Readonly<Record<AchievementTier, { text: string; fill: string; ring: string; bar: string }>> = {
  bronze: { text: "text-medal-bronze", fill: "bg-medal-bronze/15", ring: "ring-medal-bronze/40", bar: "bg-medal-bronze" },
  silver: { text: "text-medal-silver", fill: "bg-medal-silver/15", ring: "ring-medal-silver/40", bar: "bg-medal-silver" },
  gold: { text: "text-medal-gold", fill: "bg-medal-gold/15", ring: "ring-medal-gold/40", bar: "bg-medal-gold" },
  platinum: { text: "text-medal-platinum", fill: "bg-medal-platinum/15", ring: "ring-medal-platinum/45", bar: "bg-medal-platinum" },
};

const SIZE_PX = { sm: 26, md: 36, lg: 48 } as const;

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
  return (
    <AwardCoin
      emblem={hidden ? "unknown" : CATEGORY_EMBLEM[category] ?? "shield"}
      metal={hidden ? null : tier}
      size={SIZE_PX[size]}
      className={className}
    />
  );
}

/** A small tier pip: earned = a tiny coin in the tier's metal tone, locked = an outline. */
export function TierDot({ tier, earned }: { tier: AchievementTier; earned: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
        earned ? cn(TIER_TONE[tier].bar, "ring-1 ring-inset ring-foreground/25 shadow-[inset_0_1px_0_hsl(var(--card)/0.6)]") : "border border-muted-foreground/40",
      )}
    />
  );
}
