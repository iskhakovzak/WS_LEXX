/**
 * Academy stages as coins: Джун = bronze (Athena's owl), Трейдер = silver (Hermes' caduceus), Сеньор = gold (Zeus'
 * thunderbolt), each in a laurel wreath with the stage name on the rim. One component for every place a stage shows:
 * the trader path ladder, the profile, cohorts, the people list (small), the promotion reveal (large).
 */
import { cn } from "@/lib/utils";
import { localeTag } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { medalsI18n } from "@/i18n/ns/medals";
import ruCommon from "@/i18n/locales/ru/common";
import { Coin } from "./coin";
import type { EmblemKey } from "./emblems";
import { LOCKED_PAINT, METALS, type Metal } from "./metal";

export type MedalStage = "junior" | "trader" | "senior";
export const MEDAL_STAGES: readonly MedalStage[] = ["junior", "trader", "senior"];

export const STAGE_METAL: Readonly<Record<MedalStage, Metal>> = { junior: "bronze", trader: "silver", senior: "gold" };
export const STAGE_EMBLEM: Readonly<Record<MedalStage, EmblemKey>> = { junior: "owl", trader: "caduceus", senior: "keraunos" };

const ALIASES: Readonly<Record<string, MedalStage>> = {
  junior: "junior", trainee: "junior", intern: "junior",
  trader: "trader",
  senior: "senior", lead: "senior",
  [ruCommon.tiers.intern.toLowerCase()]: "junior",
  [ruCommon.tiers.junior.toLowerCase()]: "junior",
  [ruCommon.tiers.trader.toLowerCase()]: "trader",
  [ruCommon.tiers.senior.toLowerCase()]: "senior",
};

/**
 * A stage key, a scaling tier key or a stored ladder name → the medal stage. The removed first stage («trainee»)
 * reads as junior, a «lead» tier as senior; anything else (an admin-made template name, none) → null: no medal.
 */
export function medalStageOf(raw: string | null | undefined): MedalStage | null {
  const k = (raw ?? "").trim().toLowerCase();
  return k ? ALIASES[k] ?? null : null;
}

/** The stage name in the UI language (the default ladder name). */
export const medalStageName = (s: MedalStage): string => commonI18n.t(`tiers.${s}`);

export function StageMedal({
  stage,
  size = 40,
  locked = false,
  shine = false,
  decorative = false,
  className,
}: {
  stage: MedalStage;
  /** px, 24…240. Rim legend from 72 px, wreath from 40 px. */
  size?: number;
  /** Not reached yet: a blank coin in the theme's muted tones. */
  locked?: boolean;
  /** Play the one-off shine sweep (promotion reveal). */
  shine?: boolean;
  /** Next to a visible stage name: hide from screen readers instead of repeating the name. */
  decorative?: boolean;
  className?: string;
}) {
  const { t } = medalsI18n.useT();
  commonI18n.useT();
  if (!MEDAL_STAGES.includes(stage)) stage = medalStageOf(stage) ?? "junior"; // a legacy key from an old row
  const name = medalStageName(stage);
  const lang = localeTag();
  return (
    <Coin
      size={size}
      paint={locked ? LOCKED_PAINT : METALS[STAGE_METAL[stage]]}
      emblem={STAGE_EMBLEM[stage]}
      locked={locked}
      wreath
      rimTop={name.toLocaleUpperCase(lang)}
      rimBottom={t("rimBottom").toLocaleUpperCase(lang)}
      shine={shine}
      label={decorative ? undefined : t(locked ? "stageLockedAria" : "stageAria", { stage: name })}
      className={cn(locked && "opacity-80", className)}
    />
  );
}

/**
 * A small medal + the stage name, in place of a stage pill. `label` = the name to show when it is not the default
 * (a stage renamed by staff); the medal follows the key.
 */
export function StageBadge({ stage, label, size = 18, className, title }: { stage: MedalStage; label?: string | null; size?: number; className?: string; title?: string }) {
  commonI18n.useT();
  const text = label?.trim() || medalStageName(stage);
  return (
    <span title={title} className={cn("inline-flex min-w-0 max-w-full items-center gap-1.5 whitespace-nowrap text-xs font-medium text-foreground", className)}>
      <StageMedal stage={stage} size={size} decorative />
      <span className="truncate">{text}</span>
    </span>
  );
}
