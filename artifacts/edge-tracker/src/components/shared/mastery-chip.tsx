import { Target } from "lucide-react";
import type { SetupMastery } from "@/lib/gamification/types";
import { cn } from "@/lib/utils";
import { gamificationI18n } from "@/i18n/ns/gamification";
import { masteryLevelName, masteryPct } from "./gamification-labels";

/** Level tone: grey for a beginner, the accent once it grows, gold-ish at the top. */
const LEVEL_TONE = ["text-muted-foreground", "text-primary", "text-primary", "text-up", "text-warn"] as const;

export type MasteryChipProps = {
  /** 0..4 (Новичок, Ученик, Практик, Эксперт, Мастер). */
  level: number;
  /** Progress inside the level: current of next (next = null at the top level). */
  progress?: { current: number; next: number | null } | null;
  /** "sm" = a pill for cards and lists (default); "xs" = just the level word with a tiny bar. */
  size?: "sm" | "xs";
  className?: string;
};

/**
 * Setup mastery (lib/gamification SetupMastery): «Практик · 3/5» with a thin progress bar. Used by the quests tab, the
 * trainer home and the playbook card — pass `{...mastery}` (a SetupMastery) or `level` + `progress` alone.
 */
export function MasteryChip({ level, progress, size = "sm", className }: MasteryChipProps) {
  const { t } = gamificationI18n.useT();
  const name = masteryLevelName(level);
  const next = progress?.next ?? null;
  const current = progress?.current ?? 0;
  const top = progress != null && next == null;
  const pct = progress ? masteryPct({ progress: { current, next } }) : 0;
  const aria = !progress || top ? t("mastery.ariaTop", { level: name }) : t("mastery.aria", { level: name, current, next: next ?? 0 });
  const tone = LEVEL_TONE[Math.max(0, Math.min(LEVEL_TONE.length - 1, level))];
  return (
    <span
      role="img"
      aria-label={aria}
      title={aria}
      className={cn(
        "inline-flex min-w-0 max-w-full shrink-0 items-center gap-1.5 rounded-full",
        size === "sm" ? "bg-foreground/[0.05] px-2 py-0.5 text-xs" : "text-2xs",
        className,
      )}
    >
      <Target className={cn("shrink-0", size === "sm" ? "h-3.5 w-3.5" : "h-3 w-3", tone)} aria-hidden="true" />
      <span className="truncate font-medium text-foreground">
        {progress && !top ? t("mastery.chip", { level: name, current, next: next ?? 0 }) : t("mastery.chipTop", { level: name })}
      </span>
      {progress && !top && (
        <span className={cn("shrink-0 overflow-hidden rounded-full bg-foreground/10", size === "sm" ? "h-1 w-8" : "h-0.5 w-6")} aria-hidden="true">
          <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </span>
      )}
    </span>
  );
}

/** Convenience: a chip straight from a SetupMastery row. */
export function SetupMasteryChip({ mastery, size, className }: { mastery: Pick<SetupMastery, "level" | "progress">; size?: "sm" | "xs"; className?: string }) {
  return <MasteryChip level={mastery.level} progress={mastery.progress} size={size} className={className} />;
}
