/**
 * Under the /trades toolbar (the one filter pattern, components/shared/filters): one removable chip per active filter
 * (`tradeFilterChips` — the period when not «Всё», and every value set inside «Фильтры (n)»), and the quiet line that
 * explains the active preset (`PresetNote`).
 */
import { Link } from "wouter";
import { X } from "lucide-react";
import { Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import type { ActiveFilter } from "@/components/shared/filters/filter-toolbar";
import { periodLabel } from "@/components/shared/period/PeriodPicker";
import { parseDayRange } from "@/lib/period-range";
import { personName } from "@/i18n/person-name";
import { commonI18n } from "@/i18n/ns/common";
import { tradesI18n } from "@/i18n/ns/trades";
import { EVENT_LABEL, HORIZON_LABEL, RESULT_LABEL, SESSION_LABEL, popoverFilterCount, type TradeFilters } from "./trade-utils";
import { PRESET_META, type Preset } from "./review-presets";
import { behaviorHref, fmtDayLong } from "./review-list";

/** Every non-default page filter as a chip (the search box shows its own text, so `q` has none). */
export function tradeFilterChips(f: TradeFilters, patch: (p: Partial<TradeFilters>) => void): ActiveFilter[] {
  const t = tradesI18n.t, tc = commonI18n.t;
  const out: ActiveFilter[] = [];
  const add = (key: string, on: unknown, label: string, clear: Partial<TradeFilters>) => { if (on) out.push({ key, label, onRemove: () => patch(clear) }); };
  if (f.period !== "all") {
    const range = parseDayRange(f.from, f.to);
    const label = f.period === "custom" && !range && (f.from || f.to)
      ? t(f.from ? "filters.periodFrom" : "filters.periodTo", { date: fmtDayLong(f.from || f.to, false) })
      : periodLabel(f.period, range);
    out.push({ key: "period", label, onRemove: () => patch({ period: "all", from: "", to: "" }) });
  }
  add("trader", f.trader, personName(f.trader), { trader: "" });
  add("outcome", f.outcome !== "all", t(`filters.outcome.${f.outcome}`), { outcome: "all" });
  add("side", f.side, f.side === "Long" ? tc("trading.long") : f.side === "Short" ? tc("trading.short") : f.side, { side: "" });
  add("horizon", f.horizon, f.horizon ? HORIZON_LABEL[f.horizon] : "", { horizon: "" });
  add("setup", f.setup, t("filters.setupChip", { setup: EVENT_LABEL[f.setup] ?? f.setup }), { setup: "" });
  add("ticker", f.ticker, f.ticker, { ticker: "" });
  add("playbook", f.playbookId, t("filters.playbookChip", { id: f.playbookId }), { playbookId: "" });
  add("session", f.session, `${tc("trading.session")}: ${SESSION_LABEL[f.session] ?? f.session}`, { session: "" });
  add("event", f.eventType, `${t("filters.eventType")}: ${EVENT_LABEL[f.eventType] ?? f.eventType}`, { eventType: "" });
  add("sector", f.sector, `${tc("trading.sector")}: ${f.sector}`, { sector: "" });
  add("tag", f.tag.trim(), t("filters.tagChip", { tag: f.tag.trim() }), { tag: "" });
  add("source", f.source, f.source ? t(`filters.sourceChip.${f.source}`) : "", { source: "" });
  add("ids", f.ids, t("filters.idsChip", { count: f.ids.split(",").filter(Boolean).length }), { ids: "" });
  add("exitEff", f.exitEffMax, t("filters.exitEffChip", { value: f.exitEffMax }), { exitEffMax: "" });
  add("mfe", f.mfeRMin, t("filters.mfeChip", { value: f.mfeRMin }), { mfeRMin: "" });
  add("left", f.leftMin, t("filters.leftChip", { value: f.leftMin }), { leftMin: "" });
  return out;
}

/** «последние 30 дней · убыток · NVDA · +2 фильтра» — what the empty states say is selected. */
export function tradesScopeLabel(f: TradeFilters): string {
  const t = tradesI18n.t, tc = commonI18n.t;
  const range = parseDayRange(f.from, f.to);
  const parts: string[] = [f.period === "custom" && range ? periodLabel("custom", range) : t(`page.scope.${f.period}`)];
  if (f.outcome !== "all") parts.push(f.outcome === "open" ? t("page.openPositions") : RESULT_LABEL[f.outcome].toLowerCase());
  if (f.horizon) parts.push(HORIZON_LABEL[f.horizon].toLowerCase());
  if (f.side) parts.push(f.side === "Long" ? tc("trading.long") : f.side === "Short" ? tc("trading.short") : f.side);
  if (f.setup) parts.push(f.setup);
  if (f.ticker) parts.push(f.ticker);
  const more = popoverFilterCount(f) - [f.outcome !== "all", f.horizon, f.side, f.setup, f.ticker].filter(Boolean).length;
  if (more > 0) parts.push(t("page.moreFilters", { count: more }));
  if (f.q.trim()) parts.push(`«${f.q.trim()}»`);
  return parts.join(" · ");
}

/** One quiet line under the chips while a preset is active: why the view is worth a look, and «закрыть». */
export function PresetNote({ preset, trader, onClose }: { preset: Preset; trader: string | null; onClose: () => void }) {
  const { t } = tradesI18n.useT();
  const meta = PRESET_META[preset];
  return (
    <div className="flex items-start gap-2 px-1 text-sm text-muted-foreground">
      <Pill tone={meta.tone} className="mt-0.5 shrink-0">{meta.label}</Pill>
      <p className="min-w-0 flex-1 pt-0.5">
        {meta.why}
        {preset === "revenge" && <> <Link href={behaviorHref(trader)} className="whitespace-nowrap text-primary hover:underline">{t("review.behaviorLink")}</Link></>}
      </p>
      <Button variant="ghost" size="icon-sm" className="shrink-0" aria-label={t("review.closePreset")} title={t("review.closePreset")} onClick={onClose}>
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
