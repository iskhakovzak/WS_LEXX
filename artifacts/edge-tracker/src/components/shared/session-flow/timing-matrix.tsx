/**
 * «Когда сетап разрешён»: the setup's matrix of allowed timings (intraday row + holds row), one tap per chip, saved at
 * once (optimistic). Nothing ticked = not restricted. Read-only for anyone but the setup's editor. It sits under the
 * strategy formula — the timing is the «when» of the trade line (connectedness).
 */
import * as React from "react";
import { Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { sessionFlowI18n } from "@/i18n/ns/sessionFlow";
import { useSaveTimings } from "./api";
import { HOLD_TIMINGS, INTRADAY_TIMINGS, isTiming, timingLabel, toggleTiming, type Timing } from "./timing";

function Row({ label, items, on, canEdit, onToggle }: { label: string; items: readonly Timing[]; on: ReadonlySet<Timing>; canEdit: boolean; onToggle: (t: Timing) => void }) {
  const { t } = sessionFlowI18n.useT();
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
      {items.map((k) => {
        const active = on.has(k);
        return (
          <button
            key={k}
            type="button"
            disabled={!canEdit}
            aria-pressed={active}
            aria-label={t("matrix.aria", { timing: timingLabel(k) })}
            onClick={() => onToggle(k)}
            className={cn(
              "h-7 rounded-full border px-2.5 text-xs transition-colors duration-[var(--dur-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "border-primary/60 bg-primary/15 font-medium text-foreground" : "border-[var(--field-border)] text-muted-foreground",
              canEdit ? "hover:bg-[var(--glass-hover-bg)]" : "cursor-default",
            )}
          >
            {timingLabel(k)}
          </button>
        );
      })}
    </div>
  );
}

export function SetupTimingMatrix({ setupId, timings, canEdit, className }: { setupId: number; timings: readonly string[] | null | undefined; canEdit: boolean; className?: string }) {
  const { t } = sessionFlowI18n.useT();
  const save = useSaveTimings(setupId);
  const list = React.useMemo(() => (timings ?? []).filter(isTiming), [timings]);
  const on = new Set(list);
  const toggle = (k: Timing) => save.mutate(toggleTiming(list, k));
  return (
    <section className={cn("flex min-w-0 flex-col gap-2", className)} aria-label={t("matrix.title")}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-foreground"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{t("matrix.title")}</p>
      {canEdit && <p className="text-xs text-muted-foreground">{t("matrix.hint")}</p>}
      <Row label={t("matrix.intraday")} items={INTRADAY_TIMINGS} on={on} canEdit={canEdit} onToggle={toggle} />
      <Row label={t("matrix.holds")} items={HOLD_TIMINGS} on={on} canEdit={canEdit} onToggle={toggle} />
      <p className="text-xs text-muted-foreground" role="status">{list.length ? t("matrix.count", { list: list.map(timingLabel).join(", ") }) : t("matrix.any")}</p>
    </section>
  );
}
