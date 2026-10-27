/**
 * Staff picker of the day's desk regime: six regimes with their playbook hint and limit multiplier, the system's
 * suggestion pre-selected and marked, an optional note. Saving = PUT /api/market-regime/day/:date (regime.set).
 */
import * as React from "react";
import { Check } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Pill } from "@/components/ds";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";
import { REGIME_KEYS, type RegimeKey } from "@/lib/market-regime";
import { marketRegimeI18n } from "@/i18n/ns/marketRegime";
import type { RegimeSuggestion } from "@/components/shared/market/regime-suggest";
import { useSetRegime } from "./api";
import { REGIME_ICON, multText, regimeHint, regimeName } from "./labels";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  current: RegimeKey | null;
  note: string | null;
  suggestion: RegimeSuggestion | null;
  multipliers: Record<RegimeKey, number> | undefined;
};

export function RegimeSetDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* The content unmounts when closed, so every opening starts from the current regime / the suggestion. */}
      <DialogContent size="md">
        <PickerBody {...props} />
      </DialogContent>
    </Dialog>
  );
}

function PickerBody({ onOpenChange, date, current, note: currentNote, suggestion, multipliers }: Props) {
  const { t } = marketRegimeI18n.useT();
  const [picked, setPicked] = React.useState<RegimeKey | null>(current ?? suggestion?.regime ?? null);
  const [note, setNote] = React.useState(currentNote ?? "");
  const save = useSetRegime(date);

  const submit = () => {
    if (!picked) return;
    save.mutate(
      { regime: picked, note: note.trim() || null, suggestion },
      {
        onSuccess: () => { toast({ title: t("set.saved") }); onOpenChange(false); },
        onError: () => toast({ title: t("set.failed"), variant: "destructive" }),
      },
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("set.title", { date: fmtDate(`${date}T12:00:00`, "weekdayDayMonth") })}</DialogTitle>
        <DialogDescription>{t("set.description")}</DialogDescription>
      </DialogHeader>
      <div role="radiogroup" aria-label={t("title")} className="flex flex-col gap-1.5">
        {REGIME_KEYS.map((k) => {
          const Icon = REGIME_ICON[k];
          const on = picked === k;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setPicked(k)}
              className={cn(
                "tile flex min-w-0 items-start gap-3 p-3 text-left transition-colors duration-200 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on ? "border-primary/60 bg-primary/10" : "hover:bg-[var(--tile-hover-bg)]",
              )}
            >
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", on ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                  {regimeName(k)}
                  {suggestion?.regime === k && <Pill tone="accent">{t("set.suggested")}</Pill>}
                </span>
                <span className="text-xs leading-snug text-muted-foreground">{regimeHint(k)}</span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{multipliers ? `×${multText(multipliers[k])}` : null}</span>
              {on && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-muted-foreground">{t("set.note")}</span>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} placeholder={t("set.notePlaceholder")} />
      </label>
      <DialogFooter>
        <Button type="button" onClick={submit} disabled={!picked || save.isPending}>{t("set.save")}</Button>
      </DialogFooter>
    </>
  );
}
