/**
 * How sure a «Что если» card is, as 1–3 ticks (the shared components/shared/confidence-ticks with the what-if wording
 * for screen readers). Used by the single-rule cards and the rule sets.
 */
import { ConfidenceTicks as Ticks, type ConfidenceLevel } from "@/components/shared/confidence-ticks";
import { whatIfI18n } from "@/i18n/ns/whatIf";

export type { ConfidenceLevel };

export function ConfidenceTicks({ level, label, hint }: { level: ConfidenceLevel; label: string; hint: string }) {
  const { t } = whatIfI18n.useT();
  return <Ticks level={level} label={label} hint={hint} srText={t("suggestions.confidenceAria", { level, label })} />;
}
