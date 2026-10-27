/**
 * /analytics tabs (design audit wave 2B): the five that answer «где мой edge» on view (Обзор, Преимущество, Матрица,
 * Психология, Деск) as underlined SectionTabs; the rest under «Ещё ▾». A tab opened from «Ещё» takes the menu's place
 * with its own name and the underline, so the choice stays visible.
 */
import type { LucideIcon } from "lucide-react";
import { ChevronDown } from "lucide-react";
import { Kbd, SectionTabs } from "@/components/ds";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { analyticsI18n } from "@/i18n/ns/analytics";

export type AnalyticsTabItem<T extends string> = { value: T; key: string; icon: LucideIcon; more: boolean; label: string };

export function AnalyticsTabBar<T extends string>({ tabs, value, onChange }: {
  tabs: AnalyticsTabItem<T>[]; value: T; onChange: (v: T) => void;
}) {
  const { t } = analyticsI18n.useT();
  const main = tabs.filter((x) => !x.more);
  const more = tabs.filter((x) => x.more);
  const activeMore = more.find((x) => x.value === value) ?? null;
  return (
    <div className="flex min-w-0 items-end border-b border-[var(--glass-border)]">
      <SectionTabs<T>
        ariaLabel={t("tabsAria")}
        tabs={main.map((x) => ({ value: x.value, label: x.label, icon: x.icon }))}
        value={value}
        onChange={onChange}
        className="min-w-0 border-b-0"
      />
      {more.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t("moreAria")}
            className={cn(
              "relative inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11",
              activeMore ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {activeMore ? <activeMore.icon className="h-4 w-4" aria-hidden="true" /> : null}
            {activeMore ? activeMore.label : t("more")}
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            {activeMore && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" aria-hidden="true" />}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {more.map((x) => (
              <DropdownMenuItem key={x.value} onSelect={() => onChange(x.value)} className="gap-2">
                <x.icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span className="flex-1">{x.label}</span>
                {x.key && <Kbd>{x.key}</Kbd>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
