/**
 * Award token of the medal family (achievements, quests): the same struck coin as a stage medal, without the wreath
 * and the rim legend. `metal` null = not earned yet (a blank in muted tones); `ring` = progress around a token that
 * is still being worked on; `dim` = a finished-without-reward token (failed / expired quest).
 */
import { cn } from "@/lib/utils";
import { Coin } from "./coin";
import type { EmblemKey } from "./emblems";
import { LOCKED_PAINT, METALS, type Metal } from "./metal";

export function AwardCoin({
  emblem,
  metal,
  size = 36,
  ring = null,
  dim = false,
  shine = false,
  label,
  className,
}: {
  emblem: EmblemKey;
  metal: Metal | null;
  size?: number;
  ring?: number | null;
  dim?: boolean;
  shine?: boolean;
  /** Accessible name; omit when the text next to the coin already says it. */
  label?: string;
  className?: string;
}) {
  return (
    <Coin
      size={size}
      paint={metal ? METALS[metal] : LOCKED_PAINT}
      emblem={emblem}
      locked={!metal}
      ring={ring}
      shine={shine}
      label={label}
      className={cn(dim && "opacity-55 grayscale", className)}
    />
  );
}
