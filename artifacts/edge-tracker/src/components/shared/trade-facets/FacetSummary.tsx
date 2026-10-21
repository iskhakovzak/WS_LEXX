/**
 * Above a trade list: the hidden values of the «Фильтры» panel as chips (× brings one back). The «Исключить IMX» switch
 * (ImxToggle) and the «Итог $X · из них IMX $Y» line (ImxLine) are used in the FacetPanel header, «Разбор дня» and
 * «Мой разбор». IMX = close-auction trades (strategy MOC, tag «IMX») — kept in every list and number by default.
 */
import { useId } from "react";
import { X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { fmtUsd } from "@/lib/format";
import { tradeFacetsI18n } from "@/i18n/ns/tradeFacets";
import { toggleKey, uncheckedChips, type FacetLine, type FacetView, type FacetsResponse } from "@/lib/trade-facets";

const money = (v: number | null | undefined) => fmtUsd(v ?? 0, { signed: true, decimals: "auto" });

export function ImxToggle({ value, onChange, className }: { value: boolean; onChange: (v: boolean) => void; className?: string }) {
  const t = tradeFacetsI18n.t;
  const id = useId();
  return (
    <span className={cn("inline-flex min-h-9 items-center gap-2 text-sm", className)} title={t("imx.hint")}>
      <Switch id={id} checked={value} onCheckedChange={onChange} />
      <label htmlFor={id} className="cursor-pointer select-none">{t("imx.toggle")}</label>
    </span>
  );
}

/** «Итог $X · из них IMX $Y» (or, excluded, «Итог $X без IMX · IMX исключены: $Y»); nothing without IMX trades. */
export function ImxLine({ total, imx, excluded, className }: { total: number | null | undefined; imx: FacetLine | null | undefined; excluded: boolean; className?: string }) {
  const t = tradeFacetsI18n.t;
  if (!imx || imx.count === 0) return null;
  const imxText = `${money(imx.net)} (${t("imx.trades", { count: imx.count })})`;
  return (
    <span className={cn("block text-xs tabular-nums text-muted-foreground", className)}>
      {t(excluded ? "imx.lineExcluded" : "imx.line", { total: money(total), imx: imxText })}
    </span>
  );
}

/** The hidden-value chips under the «Фильтры» panel (the IMX switch and line are in the panel header). */
export function FacetSummary({ view, onChange, data, className }: { view: FacetView; onChange: (next: FacetView) => void; data: FacetsResponse | undefined; className?: string }) {
  const t = tradeFacetsI18n.t;
  const all = uncheckedChips(view, data);
  if (all.length === 0) return null;
  // More than 2 hidden values in one column fold into one chip «Месяцы: скрыто 10 ×» (× brings the column back).
  const perDim = new Map<string, number>();
  for (const c of all) perDim.set(c.dim, (perDim.get(c.dim) ?? 0) + 1);
  const grouped = [...perDim].filter(([, n]) => n > 2).map(([dim, n]) => ({ dim: dim as (typeof all)[number]["dim"], n }));
  const chips = all.filter((c) => (perDim.get(c.dim) ?? 0) <= 2);
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5", className)}>
      {(chips.length > 0 || grouped.length > 0) && (
        <ul className="flex flex-wrap items-center gap-1.5" aria-label={t("activeAria")}>
          {grouped.map((g) => (
            <li key={`g:${g.dim}`} className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pl-2.5 pr-1 text-xs font-medium text-muted-foreground">
              {t("chipGroup", { dim: t(`dims.${g.dim}`), count: g.n })}
              <button
                type="button"
                onClick={() => onChange({ ...view, off: { ...view.off, [g.dim]: [] } })}
                className="grid h-6 w-6 place-items-center rounded-full hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t("restoreDim", { dim: t(`dims.${g.dim}`) })}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
          {chips.map((c) => (
            <li key={`${c.dim}:${c.key}`} className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pl-2.5 pr-1 text-xs font-medium text-muted-foreground line-through decoration-1">
              <span className="no-underline">{t(`dims.${c.dim}`)}:</span> {c.label}
              <button
                type="button"
                onClick={() => onChange(toggleKey(view, c.dim, c.key))}
                className="grid h-6 w-6 place-items-center rounded-full no-underline hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t("restore", { label: c.label, dim: t(`dims.${c.dim}`) })}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
