/**
 * «Фильтры» — the PropReports-style filter panel (lib/trade-facets): one column per dimension side by side (horizontal
 * scroll on a phone), each a list of checkboxes with the trade count and the net $ of the bucket, «все / ничего» per
 * column and a reset. Every bucket is checked by default; the selection is saved per user (useFacetView).
 * Used by /trades and /stats; the chips of the hidden values and the IMX switch live in FacetSummary.
 */
import { ChevronDown, Filter, RotateCcw } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toneOf, tonePill } from "@/components/ds";
import { fmtCount, fmtUsd } from "@/lib/format";
import { tradeFacetsI18n } from "@/i18n/ns/tradeFacets";
import {
  FACET_DIMS, activeCount, isChecked, resetFacets, setColumn, toggleKey,
  type FacetBucket, type FacetDim, type FacetView, type FacetsResponse,
} from "@/lib/trade-facets";

type Props = {
  view: FacetView;
  onChange: (next: FacetView) => void;
  data: FacetsResponse | undefined;
  loading: boolean;
  error: boolean;
  className?: string;
};

function NetChip({ net, money }: { net: number | null; money: boolean }) {
  if (!money || net == null) return null;
  return (
    <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-2xs font-semibold tabular-nums", tonePill(toneOf(net)))}>
      {fmtUsd(net, { signed: true, compact: 10_000, decimals: "auto" })}
    </span>
  );
}

function Column({ dim, buckets, view, onChange, money }: { dim: FacetDim; buckets: FacetBucket[]; view: FacetView; onChange: (v: FacetView) => void; money: boolean }) {
  const t = tradeFacetsI18n.t;
  const title = t(`dims.${dim}`);
  const keys = buckets.map((b) => b.key);
  return (
    <section className="flex w-44 shrink-0 flex-col gap-1.5 md:w-auto md:min-w-[10.5rem] md:flex-1" aria-label={title}>
      <header className="flex items-baseline justify-between gap-2 border-b border-border pb-1">
        <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        <span className="flex shrink-0 gap-1 text-2xs">
          <button type="button" className="rounded px-1 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onChange(setColumn(view, dim, keys, true))}>{t("all")}</button>
          <span aria-hidden="true" className="text-muted-foreground">/</span>
          <button type="button" className="rounded px-1 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onChange(setColumn(view, dim, keys, false))}>{t("none")}</button>
        </span>
      </header>
      {buckets.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto pr-1">
          {buckets.map((b) => {
            const checked = isChecked(view, dim, b.key);
            const id = `facet-${dim}-${b.key}`;
            return (
              <li key={b.key}>
                <label htmlFor={id} className={cn("flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-1 text-sm hover:bg-[var(--glass-hover-bg)]", !checked && "opacity-60")}>
                  <Checkbox id={id} checked={checked} onCheckedChange={() => onChange(toggleKey(view, dim, b.key))} />
                  <span className="min-w-0 flex-1 truncate" title={b.label}>{b.label}</span>
                  <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">{fmtCount(b.count)}</span>
                  <NetChip net={b.net} money={money} />
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function FacetPanel({ view, onChange, data, loading, error, className }: Props) {
  const t = tradeFacetsI18n.t;
  const hidden = activeCount(view);
  const open = view.open;
  return (
    <div className={cn("glass-panel rounded-2xl", className)} role="region" aria-label={t("aria")}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => onChange({ ...view, open: !open })}
          title={open ? t("close") : t("open")}
          className="inline-flex min-h-9 items-center gap-2 rounded-xl px-2 text-sm font-semibold hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Filter className="h-4 w-4" aria-hidden="true" />
          {t("title")}
          {hidden > 0 && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-2xs font-semibold text-primary">{t("hidden", { count: hidden })}</span>}
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
        {hidden > 0 && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onChange(resetFacets(view))}>
            <RotateCcw aria-hidden="true" />{t("reset")}
          </Button>
        )}
      </div>
      {open && (
        <div className="border-t border-border px-3 pb-3 pt-2">
          {error && !data ? (
            <p className="text-sm text-muted-foreground">{t("loadFailed")}</p>
          ) : loading && !data ? (
            <div className="flex gap-3 overflow-hidden">{FACET_DIMS.slice(0, 5).map((d) => <Skeleton key={d} className="h-40 w-44 shrink-0" />)}</div>
          ) : (
            <div className="-mx-3 flex gap-4 overflow-x-auto px-3 pb-1" aria-busy={loading || undefined}>
              {FACET_DIMS.map((d) => <Column key={d} dim={d} buckets={data?.dims[d] ?? []} view={view} onChange={onChange} money={data?.money !== false} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
