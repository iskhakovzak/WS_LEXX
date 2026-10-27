/**
 * The «Исключить IMX» switch (ImxToggle) and the «Итог $X · из них IMX $Y» line (ImxLine): «Фильтры (n)» of the trade
 * pages (./facet-filters), «Разбор дня», the journal day and «Мой разбор». The hidden-value chips are ./facet-filters. IMX = close-auction trades (strategy MOC, tag «IMX») — kept in every list and number by default.
 */
import { useId } from "react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { fmtUsd } from "@/lib/format";
import { tradeFacetsI18n } from "@/i18n/ns/tradeFacets";
import type { FacetLine } from "@/lib/trade-facets";

const money = (v: number | null | undefined) => fmtUsd(v, { signed: true, decimals: "auto" });

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
