/**
 * How sure a «Что если» card is, as 1–3 ticks instead of a word pill: the tier's word and its explanation stay in the
 * tooltip and in screen-reader text. Used by the single-rule cards and the rule sets.
 */
import { Check } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { whatIfI18n } from "@/i18n/ns/whatIf";
import { cn } from "@/lib/utils";

export type ConfidenceLevel = 1 | 2 | 3;

export function ConfidenceTicks({ level, label, hint }: { level: ConfidenceLevel; label: string; hint: string }) {
  const { t } = whatIfI18n.useT();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-flex cursor-help items-center gap-0.5 rounded-full px-1.5 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {[1, 2, 3].map((n) => (
            <Check
              key={n}
              strokeWidth={3}
              aria-hidden="true"
              className={cn("h-3.5 w-3.5", n <= level ? (level === 3 ? "text-up" : "text-foreground") : "text-muted-foreground/30")}
            />
          ))}
          {/* Screen readers (and the page's text) get the level, the tier's word and why. */}
          <span className="sr-only">{t("suggestions.confidenceAria", { level, label })}. {hint}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">
        <span className="font-medium">{label}</span> — {hint}
      </TooltipContent>
    </Tooltip>
  );
}
