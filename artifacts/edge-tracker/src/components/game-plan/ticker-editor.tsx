import { useMemo } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Segmented } from "@/components/ds";
import { cn } from "@/lib/utils";
import { fmtPrice } from "@/lib/format";
import { HORIZON, TICKER_BIAS, type Horizon, type MediaRef, type TickerBias } from "./types";
import { MAX_TICKER_MEDIA, parseLevels, type DraftErrors, type TickerDraft } from "./plan-draft";
import { MediaStrip, TvLinkField } from "./plan-media";
import type { MediaContext } from "./media";
import { Field } from "./plan-editor-parts";
import { gpI18n } from "@/i18n/ns/gamePlan";
import { EarningsBadge } from "@/components/shared/finviz/earnings";

/** One ticker card of the «Тикеры» block: header row (ticker, bias, grade, horizon) + collapsible body. */
export function TickerEditor({
  uid,
  t,
  idx,
  mode,
  date,
  errors,
  open,
  onToggle,
  patch,
  setMedia,
  onRemove,
}: {
  uid: string;
  t: TickerDraft;
  idx: number;
  mode: MediaContext;
  date: string;
  errors: DraftErrors;
  open: boolean;
  onToggle: () => void;
  patch: (p: Partial<TickerDraft>) => void;
  setMedia: (fn: (prev: MediaRef[]) => MediaRef[]) => void;
  onRemove: () => void;
}) {
  const { t: tr } = gpI18n.useT();
  const id = (k: string) => `${uid}-t-${t.key}${k ? `-${k}` : ""}`;
  const e = (k: string) => errors[`inPlay.${t.key}.${k}`];
  const label = t.ticker.trim().toUpperCase() || tr("editor.tickerN", { n: idx + 1 });
  const summary = useMemo(() => {
    const parts: string[] = [];
    if (t.catalyst.trim()) parts.push(t.catalyst.trim());
    const sup = parseLevels(t.support).filter(Number.isFinite);
    const res = parseLevels(t.resistance).filter(Number.isFinite);
    if (sup.length || res.length) parts.push(`S ${sup.map((v) => fmtPrice(v)).join("/") || "—"} · R ${res.map((v) => fmtPrice(v)).join("/") || "—"}`);
    if (t.scenarioA.trim()) parts.push(tr("editor.scenarioA"));
    if (t.scenarioB.trim()) parts.push("B");
    if (t.media.length) parts.push(tr("editor.shots", { count: t.media.length }));
    if (t.tvLink) parts.push("TradingView");
    return parts.join(" · ");
  }, [t, tr]);
  const hasError = Object.keys(errors).some((k) => k.startsWith(`inPlay.${t.key}.`));

  return (
    <article
      data-paste-target={t.key}
      aria-label={label}
      className={cn("rounded-xl border bg-[var(--glass-bg)]", hasError ? "border-destructive/50" : "border-[var(--field-border)]")}
    >
      <div className="flex flex-wrap items-center gap-2 p-2.5">
        <Input
          id={id("")}
          aria-label={tr("editor.ticker")}
          className="h-9 w-24 font-semibold uppercase"
          autoCapitalize="characters"
          placeholder="NVDA"
          maxLength={12}
          value={t.ticker}
          aria-invalid={!!e("ticker")}
          onChange={(ev) => patch({ ticker: ev.target.value.toUpperCase() })}
        />
        <Segmented<TickerBias>
          ariaLabel={tr("editor.direction", { label })}
          size="sm"
          value={t.bias}
          onChange={(v) => patch({ bias: v })}
          options={(Object.keys(TICKER_BIAS) as TickerBias[]).map((k) => ({ value: k, label: k === "neutral" ? tr("labels.tickerBias.neutralShort") : TICKER_BIAS[k].label }))}
        />
        <Select value={t.grade} onValueChange={(v) => patch({ grade: v as TickerDraft["grade"] })}>
          <SelectTrigger aria-label={tr("editor.grade", { label })} className="h-9 min-w-[92px] w-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{tr("editor.noGrade")}</SelectItem>
            <SelectItem value="A+">A+</SelectItem>
            <SelectItem value="A">A</SelectItem>
            <SelectItem value="B">B</SelectItem>
          </SelectContent>
        </Select>
        <Select value={t.horizon} onValueChange={(v) => patch({ horizon: v as Horizon })}>
          <SelectTrigger aria-label={tr("editor.horizon", { label })} className="h-9 min-w-[124px] w-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(HORIZON) as Horizon[]).map((k) => (
              <SelectItem key={k} value={k}>
                {HORIZON[k].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <EarningsBadge ticker={t.ticker} short />
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={tr("editor.remove", { label })} title={tr("editor.remove", { label })} onClick={onRemove}>
            <Trash2 aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-expanded={open}
            aria-controls={id("body")}
            aria-label={open ? tr("editor.collapse", { label }) : tr("editor.expand", { label })}
            onClick={onToggle}
          >
            <ChevronDown className={cn("transition-transform", !open && "-rotate-90")} aria-hidden="true" />
          </Button>
        </div>
        {e("ticker") && <p className="basis-full text-xs text-destructive">{e("ticker")}</p>}
        {!open && (
          <button type="button" onClick={onToggle} className="basis-full truncate text-left text-xs text-muted-foreground hover:text-foreground">
            {summary || tr("editor.emptyCard")}
          </button>
        )}
      </div>

      {open && (
        <div id={id("body")} className="flex flex-col gap-3 border-t border-[var(--field-border)] p-3">
          <Field label={tr("editor.catalyst")} htmlFor={id("c")}>
            <Input id={id("c")} maxLength={500} placeholder={tr("editor.catalystPlaceholder")} value={t.catalyst} onChange={(ev) => patch({ catalyst: ev.target.value })} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={tr("editor.support")} htmlFor={id("s")} error={e("support")}>
              <Input id={id("s")} inputMode="decimal" placeholder="121.5 119" value={t.support} onChange={(ev) => patch({ support: ev.target.value })} className="tabular-nums" />
            </Field>
            <Field label={tr("editor.resistance")} htmlFor={id("r")} error={e("resistance")}>
              <Input id={id("r")} inputMode="decimal" placeholder="125 127.8" value={t.resistance} onChange={(ev) => patch({ resistance: ev.target.value })} className="tabular-nums" />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={tr("editor.scenarioALabel")} htmlFor={id("a")}>
              <Textarea id={id("a")} rows={2} maxLength={1500} placeholder={tr("editor.scenarioAPlaceholder")} value={t.scenarioA} onChange={(ev) => patch({ scenarioA: ev.target.value })} />
            </Field>
            <Field label={tr("editor.scenarioBLabel")} htmlFor={id("b")}>
              <Textarea id={id("b")} rows={2} maxLength={1500} placeholder={tr("editor.scenarioBPlaceholder")} value={t.scenarioB} onChange={(ev) => patch({ scenarioB: ev.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={tr("editor.trigger")} htmlFor={id("tr")}>
              <Input id={id("tr")} maxLength={1000} placeholder={tr("editor.triggerPlaceholder")} value={t.trigger} onChange={(ev) => patch({ trigger: ev.target.value })} />
            </Field>
            <Field label={tr("editor.invalidation")} htmlFor={id("iv")}>
              <Input id={id("iv")} maxLength={1000} placeholder={tr("editor.invalidationPlaceholder")} value={t.invalidation} onChange={(ev) => patch({ invalidation: ev.target.value })} />
            </Field>
          </div>
          <Field label={tr("editor.tickerRisk")} htmlFor={id("k")}>
            <Input id={id("k")} maxLength={1000} placeholder={tr("editor.tickerRiskPlaceholder")} value={t.risk_note} onChange={(ev) => patch({ risk_note: ev.target.value })} />
          </Field>
          {t.plan.trim() && (
            <Field label={tr("editor.notes")} htmlFor={id("p")}>
              <Textarea id={id("p")} rows={2} maxLength={3000} value={t.plan} onChange={(ev) => patch({ plan: ev.target.value })} />
            </Field>
          )}
          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted-foreground">{t.ticker ? tr("editor.chartMediaOf", { ticker: t.ticker.toUpperCase() }) : tr("editor.chartMedia")}</span>
            <TvLinkField
              links={t.tvLink ? [t.tvLink] : []}
              max={1}
              onChange={(l) => patch({ tvLink: l[0] ?? "" })}
              label={tr("editor.tickerTvLink", { label })}
            />
            <MediaStrip
              refs={t.media}
              onChange={setMedia}
              context={mode}
              date={date}
              max={MAX_TICKER_MEDIA}
              pasteKey={t.key}
              label={label}
              onAddTvLinks={(urls) => patch({ tvLink: urls[0] ?? t.tvLink })}
            />
          </div>
        </div>
      )}
    </article>
  );
}
