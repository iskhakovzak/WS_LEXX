/**
 * The desk regime of a day, one component for every place it shows (owner's laws: the signal sits next to the
 * action it is about — the plan, the limits — not as a banner):
 *   variant "tile"   the dashboard tile body (the page wraps it in its card); "row" — the same as one line (XL tile)
 *   variant "strip"  one quiet row in its own glass panel under the day plan / risk headers
 * Each shows the regime's name, its one-line playbook hint and the limit multiplier with the viewer's suggested
 * daily limit (base × multiplier; «применяется к стопам» when settings regime.applyLimits is on).
 * Staff (regime.set) see the system's suggestion while the day has no regime: «Подтвердить» saves it in one click,
 * «Изменить» opens the picker.
 */
import * as React from "react";
import { Gauge } from "lucide-react";
import { Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { PendingIcon } from "@/components/ui/pending-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { fmtDate, fmtUsd } from "@/lib/format";
import { nyDate } from "@/lib/trading-date";
import { personName } from "@/i18n";
import { marketRegimeI18n } from "@/i18n/ns/marketRegime";
import type { RegimeSuggestion } from "@/components/shared/market/regime-suggest";
import { useRegimeSuggestion, useRegimeToday, useSetRegime, type RegimeToday } from "./api";
import { REGIME_ICON, REGIME_TONE, multText, reasonText, regimeHint, regimeName } from "./labels";
import { RegimeSetDialog } from "./regime-set-dialog";

/** tile = compact card body; row = the same as one wide line (an XL tile); strip = a row in its own glass panel. */
type Variant = "tile" | "row" | "strip";

function LimitLine({ data, variant }: { data: RegimeToday; variant: Variant }) {
  const { t } = marketRegimeI18n.useT();
  if (!data.day) return null;
  const mult = multText(data.multiplier);
  const lim = data.limit;
  return (
    <p className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground tabular-nums", variant === "tile" && "mt-auto")}>
      <Pill tone={data.multiplier < 1 ? "warn" : "neutral"}>{t("limit.multiplier", { value: mult })}</Pill>
      {lim?.suggested != null && (
        <span>
          <span className="font-medium text-foreground">{t("limit.suggested", { limit: fmtUsd(lim.suggested, { decimals: "auto" }) })}</span>
          {data.multiplier !== 1 && <> · {t("limit.suggestedFrom", { base: fmtUsd(lim.base, { decimals: "auto" }), mult })}</>}
        </span>
      )}
      {lim?.suggested != null && data.multiplier !== 1 && <span>{t(data.applyLimits ? "limit.applied" : "limit.hintOnly")}</span>}
    </p>
  );
}

function SuggestionBlock({ s, loading, onConfirm, onChange, pending, variant }: {
  s: RegimeSuggestion | null; loading: boolean; onConfirm: () => void; onChange: () => void; pending: boolean; variant: Variant;
}) {
  const { t } = marketRegimeI18n.useT();
  if (loading) return <p className="text-xs text-muted-foreground" aria-live="polite">{t("suggest.loading")}</p>;
  const reasons = s ? s.reasons.slice(0, variant === "tile" ? 3 : 2).map(reasonText) : [];
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", variant !== "tile" && "sm:flex-row sm:items-center sm:gap-3")}>
      <div className="min-w-0">
        <p className="text-sm">{s ? t("suggest.text", { name: regimeName(s.regime) }) : t("suggest.none")}</p>
        {reasons.length > 0 && (
          <p className="text-xs text-muted-foreground" title={s ? t("suggest.asOf", { date: fmtDate(`${s.asOf}T12:00:00`, "dayMonth") }) : undefined}>
            {reasons.join(" · ")}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap gap-1.5">
        {s && <Button type="button" size="sm" onClick={onConfirm} disabled={pending} aria-busy={pending}><PendingIcon pending={pending} />{t("set.confirm")}</Button>}
        <Button type="button" size="sm" variant={s ? "outline" : "default"} onClick={onChange}>{t(s ? "set.change" : "set.choose")}</Button>
      </div>
    </div>
  );
}

export function RegimeDayView({ date, variant, className }: { date?: string; variant: Variant; className?: string }) {
  const { t } = marketRegimeI18n.useT();
  const day = date ?? nyDate();
  const q = useRegimeToday(day);
  const [open, setOpen] = React.useState(false);
  const data = q.data;
  const canSet = !!data?.canSet;
  const sug = useRegimeSuggestion(canSet && (open || !data?.day));
  const setRegime = useSetRegime(day);

  if (q.isLoading) return <Skeleton className={cn(variant === "tile" ? "h-24 w-full" : "h-10 w-full rounded-2xl", className)} />;
  if (!data) return null; // the regime is context, never a blocking error

  const confirm = () => {
    if (!sug.suggestion) return;
    setRegime.mutate(
      { regime: sug.suggestion.regime, suggestion: sug.suggestion },
      { onSuccess: () => toast({ title: t("set.saved") }), onError: () => toast({ title: t("set.failed"), variant: "destructive" }) },
    );
  };
  const r = data.day?.regime ?? null;
  const Icon = r ? REGIME_ICON[r] : Gauge;
  const isToday = day === nyDate();
  const who = data.day ? t(data.day.autoSuggested ? "day.setByAuto" : "day.setBy", { name: personName(data.day.setBy) }) : null;

  const head = r ? (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Pill tone={REGIME_TONE[r]} className="text-sm">
        <Icon aria-hidden="true" />
        {regimeName(r)}
      </Pill>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <Gauge className="h-4 w-4" aria-hidden="true" />
      {isToday ? t("day.notSet") : t("day.notSetFor", { date: fmtDate(`${day}T12:00:00`, "dayMonth") })}
    </span>
  );

  const body = r ? (
    <>
      <p className={cn("text-sm leading-snug text-foreground", variant !== "tile" ? "min-w-0 sm:flex-1" : "line-clamp-3")}>{regimeHint(r)}</p>
      <LimitLine data={data} variant={variant} />
      {variant !== "strip" && (data.day?.note || who) && (
        <p className="line-clamp-2 text-xs text-muted-foreground" title={data.day?.note ?? undefined}>
          {[data.day?.note ? t("day.note", { note: data.day.note }) : null, who].filter(Boolean).join(" · ")}
        </p>
      )}
    </>
  ) : canSet ? (
    <SuggestionBlock s={sug.suggestion} loading={sug.isLoading} onConfirm={confirm} onChange={() => setOpen(true)} pending={setRegime.isPending} variant={variant} />
  ) : (
    <p className="text-xs text-muted-foreground">{t("day.notSetHint")}</p>
  );

  const change = r && canSet ? (
    <Button type="button" size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-xs" onClick={() => setOpen(true)}>{t("set.change")}</Button>
  ) : null;

  return (
    <section
      aria-label={t("title")}
      className={cn(
        variant === "tile"
          ? "flex h-full min-w-0 flex-col gap-2"
          : "flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4",
        variant === "strip" && "glass-panel rounded-2xl px-[var(--panel-p)] py-3",
        "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300",
        className,
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        {head}
        {variant === "tile" && change}
      </div>
      {body}
      {variant !== "tile" && change}
      {canSet && (
        <RegimeSetDialog
          open={open}
          onOpenChange={setOpen}
          date={day}
          current={r}
          note={data.day?.note ?? null}
          suggestion={sug.suggestion}
          multipliers={data.multipliers}
        />
      )}
    </section>
  );
}
