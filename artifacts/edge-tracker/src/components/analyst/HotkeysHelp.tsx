/** «?» in the /analyst-actions header: the page's keys (the key hints live here, not in the filter row). */
import { HelpCircle } from "lucide-react";
import { Kbd } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { analystI18n } from "@/i18n/ns/analyst";

/** Key → hotkey label key (labels resolved at render). */
const HOTKEYS = [
  ["/", "search"],
  ["T", "session"],
  ["M", "mine"],
  ["J / K", "rows"],
  ["Enter", "open"],
  ["W", "watch"],
  ["P", "plan"],
  ["Esc", "reset"],
] as const;

export function HotkeysHelp() {
  const { t } = analystI18n.useT();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("page.hotkeysAria")}>
          <HelpCircle aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="w-64">
        <div className="flex flex-col gap-1.5 py-0.5">
          <span className="text-xs font-semibold text-foreground">{t("page.hotkeysAria")}</span>
          {HOTKEYS.map(([k, label]) => (
            <span key={k} className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              {t(`page.hotkeys.${label}`)} <Kbd>{k}</Kbd>
            </span>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
