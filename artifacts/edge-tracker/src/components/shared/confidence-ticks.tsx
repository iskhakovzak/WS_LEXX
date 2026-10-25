/**
 * How sure a finding is, as 1–3 ticks instead of a word pill: the tier's word and its explanation stay in the tooltip
 * and in screen-reader text (`srText`, already localized by the caller). Used by the «Что если» cards and rule sets
 * (components/what-if/confidence-ticks wraps it) and by «Рекомендации офису».
 */
import { Check } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type ConfidenceLevel = 1 | 2 | 3;

export function ConfidenceTicks({ level, label, hint, srText }: { level: ConfidenceLevel; label: string; hint: string; srText: string }) {
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
          <span className="sr-only">{srText}. {hint}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">
        <span className="font-medium">{label}</span> — {hint}
      </TooltipContent>
    </Tooltip>
  );
}
