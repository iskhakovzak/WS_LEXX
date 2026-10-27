/**
 * The regimes a playbook setup works best in: chips on the setup card, and for whoever may edit the setup a small
 * popover with six toggles (each toggle saves at once — PUT /api/market-regime/playbook/:id/regimes). The chip of
 * today's desk regime is highlighted, so «подходит сегодня» reads on the card itself.
 */
import * as React from "react";
import { Check, Gauge } from "lucide-react";
import { Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { REGIME_KEYS, isRegimeKey, type RegimeKey } from "@/lib/market-regime";
import { marketRegimeI18n } from "@/i18n/ns/marketRegime";
import { useRegimeToday, useSetPlaybookRegimes } from "./api";
import { REGIME_ICON, regimeName } from "./labels";

export function RegimeTags({ id, regimes, canEdit }: { id: number; regimes: readonly string[] | null | undefined; canEdit: boolean }) {
  const { t } = marketRegimeI18n.useT();
  const today = useRegimeToday().data?.day?.regime ?? null;
  const saved = React.useMemo(() => (regimes ?? []).filter(isRegimeKey), [regimes]);
  const [draft, setDraft] = React.useState<RegimeKey[] | null>(null);
  const shown = draft ?? saved;
  const save = useSetPlaybookRegimes();
  if (!shown.length && !canEdit) return null;

  const toggle = (k: RegimeKey) => {
    const next = REGIME_KEYS.filter((x) => (x === k ? !shown.includes(k) : shown.includes(x)));
    setDraft(next);
    save.mutate({ id, regimes: next }, {
      onSettled: () => setDraft(null),
      onError: () => toast({ title: t("set.failed"), variant: "destructive" }),
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label={t("playbook.tagsAria")}>
      {shown.map((k) => {
        const Icon = REGIME_ICON[k];
        return (
          <Pill key={k} tone={k === today ? "accent" : "neutral"} title={k === today ? t("playbook.today") : undefined}>
            <Icon aria-hidden="true" />
            {regimeName(k)}
          </Pill>
        );
      })}
      {canEdit && (
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs text-muted-foreground">
              <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
              {shown.length ? t("playbook.edit") : t("playbook.tags")}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-1.5">
            <ul className="flex flex-col">
              {REGIME_KEYS.map((k) => {
                const on = shown.includes(k);
                const Icon = REGIME_ICON[k];
                return (
                  <li key={k}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(k)}
                      className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-150 hover:bg-[var(--tile-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", on && "text-foreground")}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{regimeName(k)}</span>
                      {k === today && <Pill tone="accent">{marketRegimeI18n.t("edge.today")}</Pill>}
                      <Check className={cn("h-4 w-4 shrink-0 text-primary", !on && "invisible")} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
