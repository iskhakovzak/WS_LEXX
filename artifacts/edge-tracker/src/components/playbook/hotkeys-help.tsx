/** «?» popover of the playbook library: the keyboard shortcuts (the page owns the open state — «?» toggles it). */
import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Kbd } from "@/components/ds";
import { playbookI18n } from "@/i18n/ns/playbook";

type HotkeyKey = keyof typeof import("@/i18n/locales/ru/playbook").default.page.hotkeys;
const HOTKEYS: [string[], HotkeyKey][] = [
  [["Ctrl", "K"], "quickFindSetup"],
  [["/"], "quickFind"],
  [["J", "K"], "nextPrev"],
  [["N"], "newSetup"],
  [["Ctrl", "S"], "saveForm"],
  [["E"], "edit"],
  [["A"], "addExamples"],
  [["C"], "compare"],
  [["Esc"], "close"],
  [["1", "2", "3"], "tier"],
  [["Alt", "↑↓"], "reorder"],
  [["M"], "moveExample"],
  [["Ctrl", "V"], "paste"],
];

export function HotkeysHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = playbookI18n.useT();
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("page.hotkeysTitle")}
          title={t("page.hotkeysTitle")}
          aria-keyshortcuts="?"
          className="inline-grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <HelpCircle className="h-4 w-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <p className="mb-2 text-sm font-semibold text-foreground">{t("page.hotkeysTitle")}</p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 text-sm">
          {HOTKEYS.map(([keys, key]) => (
            <div key={key} className="contents">
              <dt><Kbd keys={keys} className="[&_kbd]:text-xs" /></dt>
              <dd className="text-muted-foreground">{t(`page.hotkeys.${key}`)}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">{t("page.mouseHint")}</p>
      </PopoverContent>
    </Popover>
  );
}
