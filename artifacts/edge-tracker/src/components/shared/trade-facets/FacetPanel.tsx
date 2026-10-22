/**
 * «Фильтры» — the PropReports-style filter panel (lib/trade-facets). The dimensions come in four groups (FACET_GROUPS:
 * when · how · what · result and tags), each a small uppercase heading over a grid that wraps into rows (no horizontal
 * scroll at any width, one column on a phone); a group without a visible column is left out. A long column (tickers,
 * times) scrolls inside itself. Each value is a row with a profit bar behind it (green / red,
 * length = |net| relative to the column's largest; trade count when money is hidden); a click excludes the value
 * (struck through, dimmed), a second click brings it back. Columns with a single value and nothing excluded carry no
 * choice, so they fold into one short line under the grid. Every value is in by default; the selection is saved per
 * user (useFacetView). Used by /trades and /stats; the «Исключить IMX» switch sits in the header; the chips of the hidden values are in FacetSummary.
 * «Найти тикер» next to the tabs: while it holds text, the matching tickers (from any tab) replace the tab's columns,
 * with «Только найденные» to keep just them.
 */
import { useRef, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { ChevronDown, Filter, RotateCcw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toneBg, toneOf, toneText } from "@/components/ds";
import { fmtCount, fmtUsd } from "@/lib/format";
import { tradeFacetsI18n } from "@/i18n/ns/tradeFacets";
import { ImxLine, ImxToggle } from "./FacetSummary";
import {
  AGGRESSIVE_ADDS_MIN, AGGRESSIVE_GAP_SEC, AGGRESSIVE_SIZE_MULT, AGGRESSIVE_WINDOW_SEC, FACET_DIMS, FACET_GROUPS,
  SIZE_REL_DAYS, SIZE_REL_MIN_TRADES, UNKNOWN_KEY, activeCount, isChecked, resetFacets, setColumn, toggleKey,
  type FacetBucket, type FacetDim, type FacetView, type FacetsResponse,
} from "@/lib/trade-facets";

/** One sentence on how a derived bucket is decided (strategy rules, aggressive adds, pyramid / averaging, size vs usual), for the row tooltip. */
function facetHint(dim: FacetDim, key: string): string | null {
  const t = tradeFacetsI18n.t;
  if (dim === "strategies" && (STRATEGY_HINT_KEYS as readonly string[]).includes(key)) return t(`hints.strategy.${key as StrategyHintKey}`);
  if (dim === "entry" && key === "aggressive") {
    return t("hints.aggressive", { adds: AGGRESSIVE_ADDS_MIN, min: AGGRESSIVE_WINDOW_SEC / 60, mult: AGGRESSIVE_SIZE_MULT, gap: AGGRESSIVE_GAP_SEC });
  }
  if (dim === "adds" && (key === "pyramid" || key === "average")) return t(`hints.${key}`);
  if (dim === "sizeRel" && key !== UNKNOWN_KEY) return t("hints.sizeRel", { days: SIZE_REL_DAYS, min: SIZE_REL_MIN_TRADES });
  return null;
}

/** Strategy codes with a rule hint (api lib/tradeStrategy TRADE_STRATEGIES). */
const STRATEGY_HINT_KEYS = ["OPG", "Print", "OPGtoDAY", "Day", "MOC", "AfterMarket", "Overnight", "Swing", "Adjust", "OPT"] as const;
type StrategyHintKey = (typeof STRATEGY_HINT_KEYS)[number];

type Props = {
  view: FacetView;
  onChange: (next: FacetView) => void;
  data: FacetsResponse | undefined;
  loading: boolean;
  error: boolean;
  className?: string;
};

const GRID = "grid gap-x-5 gap-y-4 [grid-template-columns:repeat(auto-fill,minmax(10.5rem,1fr))]";
const LINK = "inline-flex min-h-6 min-w-6 items-center justify-center rounded px-1.5 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** A column offers a choice only with 2+ values, or when something in it is already excluded (so it can come back). */
function hasChoice(dim: FacetDim, buckets: FacetBucket[], view: FacetView): boolean {
  return buckets.length > 1 || buckets.some((b) => !isChecked(view, dim, b.key));
}

function Row({ dim, b, scale, money, view, onChange }: {
  dim: FacetDim; b: FacetBucket; scale: number; money: boolean; view: FacetView; onChange: (v: FacetView) => void;
}) {
  const t = tradeFacetsI18n.t;
  const on = isChecked(view, dim, b.key);
  const showNet = money && b.net != null;
  const size = showNet ? Math.abs(b.net as number) : b.count;
  const pct = scale > 0 ? Math.max(4, Math.round((size / scale) * 100)) : 0;
  const tone = showNet ? toneOf(b.net) : "neutral";
  // Whole dollars in the row (fits the column); the exact amount is in the tooltip.
  const net = showNet ? fmtUsd(b.net as number, { signed: true, compact: 10_000, decimals: 0 }) : "";
  const exact = showNet ? fmtUsd(b.net as number, { signed: true }) : "";
  const hint = facetHint(dim, b.key);
  return (
    <li>
      <button
        type="button"
        aria-pressed={on}
        onClick={() => onChange(toggleKey(view, dim, b.key))}
        title={`${b.label} · ${fmtCount(b.count)}${exact ? ` · ${exact}` : ""}${hint ? `\n${hint}` : ""}\n${on ? t("exclude", { label: b.label }) : t("include", { label: b.label })}`}
        aria-label={t("bucketAria", { label: b.label, count: b.count, net: exact || fmtCount(b.count) })}
        className={cn(
          "group relative flex h-7 w-full items-center gap-2 overflow-hidden rounded-md px-1.5 text-left text-xs transition-colors",
          "hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          !on && "text-muted-foreground",
        )}
      >
        <span
          aria-hidden="true"
          className={cn("absolute inset-y-1 left-0 rounded-r-sm transition-[width,opacity]", on ? toneBg(tone) : "bg-muted-foreground", on ? "opacity-20" : "opacity-10")}
          style={{ width: `${pct}%` }}
        />
        <span className={cn("relative min-w-0 flex-1 truncate", !on && "line-through decoration-muted-foreground/60")}>{b.label}</span>
        <span className="relative shrink-0 tabular-nums text-muted-foreground">{fmtCount(b.count)}</span>
        {showNet && <span className={cn("relative shrink-0 whitespace-nowrap text-right font-semibold tabular-nums", on ? toneText(tone) : "")}>{net}</span>}
      </button>
    </li>
  );
}

function Column({ dim, buckets, view, onChange, money }: { dim: FacetDim; buckets: FacetBucket[]; view: FacetView; onChange: (v: FacetView) => void; money: boolean }) {
  const t = tradeFacetsI18n.t;
  const title = t(`dims.${dim}`);
  const keys = buckets.map((b) => b.key);
  const excluded = buckets.filter((b) => !isChecked(view, dim, b.key)).length;
  const scale = buckets.reduce((m, b) => Math.max(m, money && b.net != null ? Math.abs(b.net) : b.count), 0);
  return (
    <section className="flex min-w-0 flex-col gap-1" aria-label={title}>
      <header className="flex items-center justify-between gap-2 border-b border-border pb-1">
        <h4 title={title} className="truncate text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}{excluded > 0 && <span className="ml-1 text-primary">−{excluded}</span>}
        </h4>
        <span className="flex shrink-0 gap-0.5 text-2xs">
          <button type="button" className={LINK} onClick={() => onChange(setColumn(view, dim, keys, true))}>{t("all")}</button>
          <span aria-hidden="true" className="text-muted-foreground">/</span>
          <button type="button" className={LINK} onClick={() => onChange(setColumn(view, dim, keys, false))}>{t("none")}</button>
        </span>
      </header>
      <ul className="flex max-h-[13rem] flex-col gap-px overflow-y-auto pr-0.5">
        {buckets.map((b) => <Row key={b.key} dim={dim} b={b} scale={scale} money={money} view={view} onChange={onChange} />)}
      </ul>
    </section>
  );
}

type GroupId = (typeof FACET_GROUPS)[number]["id"];
type Group = { id: GroupId; cols: { d: FacetDim; buckets: FacetBucket[] }[] };
const TAB_KEY = "ws.facets.tab";
function readTab(): GroupId {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return (FACET_GROUPS.find((g) => g.id === v)?.id ?? "when") as GroupId;
  } catch { return "when"; }
}
function writeTab(id: GroupId) {
  try { localStorage.setItem(TAB_KEY, id); } catch { /* storage blocked */ }
}

/** Segmented tabs «Когда · Как · Что · Итог и теги»; a tab with excluded values shows their count. Arrow keys move. */
function GroupTabs({ groups, active, onPick, view }: { groups: Group[]; active: GroupId | null; onPick: (id: GroupId) => void; view: FacetView }) {
  const t = tradeFacetsI18n.t;
  const move = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = groups[(i + d + groups.length) % groups.length];
    onPick(next.id);
    document.getElementById(`facet-tab-${next.id}`)?.focus();
  };
  return (
    <div role="tablist" aria-label={t("aria")} className="inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-muted/40 p-1">
      {groups.map((g, i) => {
        const on = g.id === active;
        const off = FACET_GROUPS.find((x) => x.id === g.id)!.dims.reduce((n, d) => n + (view.off[d]?.length ?? 0), 0);
        return (
          <button
            key={g.id}
            id={`facet-tab-${g.id}`}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={`facet-panel-${g.id}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onPick(g.id)}
            onKeyDown={(e) => move(e, i)}
            className={cn(
              "inline-flex min-h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "bg-background text-foreground shadow-sm" : "text-foreground/75 hover:text-foreground",
            )}
          >
            {t(`groups.${g.id}`)}
            <span className={cn("tabular-nums", on ? "text-muted-foreground" : "text-foreground/75")}>{g.cols.length}</span>
            {off > 0 && <span className="rounded-full bg-primary/15 px-1.5 text-2xs text-primary">−{off}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** «Найти тикер» next to the tabs; Escape clears. */
function TickerSearch({ q, onQ }: { q: string; onQ: (v: string) => void }) {
  const t = tradeFacetsI18n.t;
  return (
    <div className="relative w-full sm:w-56">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        type="search"
        value={q}
        onChange={(e) => onQ(e.target.value.toUpperCase().replace(/[^A-Z0-9.\-]/g, ""))}
        onKeyDown={(e) => { if (e.key === "Escape" && q) { e.preventDefault(); onQ(""); } }}
        placeholder={t("tickerSearchPlaceholder")}
        aria-label={t("tickerSearch")}
        autoComplete="off"
        spellCheck={false}
        className="h-9 w-full rounded-xl border border-border bg-background/60 pl-8 pr-8 text-sm uppercase placeholder:normal-case placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden"
      />
      {q && (
        <button
          type="button"
          onClick={() => onQ("")}
          aria-label={t("tickerClear")}
          title={t("tickerClear")}
          className="absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** Tickers matching the search (prefix first, then the rest containing it) as an ordinary column, plus «Только найденные». */
function TickerResults({ q, buckets, view, onChange, money }: { q: string; buckets: FacetBucket[]; view: FacetView; onChange: (v: FacetView) => void; money: boolean }) {
  const t = tradeFacetsI18n.t;
  const hits = buckets
    .filter((b) => b.key !== UNKNOWN_KEY && b.label.toUpperCase().includes(q))
    .sort((a, b) => Number(!a.label.toUpperCase().startsWith(q)) - Number(!b.label.toUpperCase().startsWith(q)));
  if (hits.length === 0) return <p role="status" className="mt-3 text-sm text-muted-foreground">{t("tickerNotFound", { q })}</p>;
  const hitKeys = new Set(hits.map((b) => b.key));
  const onlyThese = () => onChange({ ...view, off: { ...view.off, tickers: buckets.filter((b) => !hitKeys.has(b.key)).map((b) => b.key) } });
  return (
    <div className="mt-3 animate-in fade-in-0 duration-150 motion-reduce:animate-none">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span role="status">{t("tickerFound", { n: hits.length })}</span>
        <Button variant="outline" size="sm" onClick={onlyThese} title={t("tickerOnlyHint")}>{t("tickerOnly")}</Button>
      </div>
      <div className={GRID}>
        <Column dim="tickers" buckets={hits} view={view} onChange={onChange} money={money} />
      </div>
    </div>
  );
}

export function FacetPanel({ view, onChange, data, loading, error, className }: Props) {
  const t = tradeFacetsI18n.t;
  const hidden = activeCount(view);
  // On a phone the panel starts folded each visit (open it pushes the trade list a screen down); the saved
  // open/closed state is the desktop one.
  const isMobile = !!useIsMobile();
  const [phoneOpen, setPhoneOpen] = useState(false);
  const open = isMobile ? phoneOpen : view.open;
  const toggle = () => (isMobile ? setPhoneOpen((v) => !v) : onChange({ ...view, open: !view.open }));
  const money = data?.money !== false;
  // Last non-empty values of every column: when the exclusions leave no trades, the other columns come back empty —
  // keep showing their values (count 0) so the panel never collapses to one column and every choice stays reachable.
  const memo = useRef<Partial<Record<FacetDim, FacetBucket[]>>>({});
  for (const d of FACET_DIMS) { const b = data?.dims[d]; if (b && b.length) memo.current[d] = b; }
  const nothingLeft = !!data && data.total.count === 0 && hidden > 0;
  const dims = FACET_DIMS.map((d) => {
    const live = data?.dims[d] ?? [];
    const buckets = live.length || !nothingLeft ? live : (memo.current[d] ?? []).map((b) => ({ ...b, count: 0, net: null }));
    return { d, buckets };
  });
  // Columns with every value excluded — the usual reason for «nothing left».
  const emptied = dims.filter((x) => x.buckets.length > 0 && x.buckets.every((b) => !isChecked(view, x.d, b.key)));
  const shown = dims.filter((x) => hasChoice(x.d, x.buckets, view));
  const folded = dims.filter((x) => x.buckets.length === 1 && !hasChoice(x.d, x.buckets, view));
  // Groups «when / how / what / result and tags»; a group without a visible column is left out.
  const groups = FACET_GROUPS.map((g) => ({ id: g.id, cols: shown.filter((x) => g.dims.includes(x.d)) })).filter((g) => g.cols.length > 0);
  // One group at a time (tabs): the panel stays one row of columns high instead of four stacked rows.
  const [tab, setTab] = useState<GroupId>(readTab);
  const pickTab = (id: GroupId) => { setTab(id); writeTab(id); };
  const current = groups.find((g) => g.id === tab) ?? groups[0];
  // Ticker search across the whole panel: the matching tickers replace the tab's columns while the box is not empty.
  const [q, setQ] = useState("");
  const tickerBuckets = dims.find((x) => x.d === "tickers")?.buckets ?? [];
  return (
    <div className={cn("glass-panel rounded-2xl", className)} role="region" aria-label={t("aria")}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={toggle}
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
        {/* «Исключить IMX» lives in the header: visible with the panel folded, never pushed below a tall grid. */}
        <ImxToggle
          value={view.excludeImx}
          onChange={(v) => onChange({ ...view, excludeImx: v })}
          className={cn("rounded-xl border px-2.5", view.excludeImx ? "border-primary/40 bg-primary/10" : "border-border")}
        />
        {data && money && <ImxLine total={data.total.net} imx={data.imx} excluded={view.excludeImx} />}
        {open && <span className="hidden text-2xs text-muted-foreground xl:inline">{t("clickHint")}</span>}
      </div>
      {open && (
        <div className="border-t border-border px-3 pb-3 pt-3">
          {error && !data ? (
            <p className="text-sm text-muted-foreground">{t("loadFailed")}</p>
          ) : loading && !data ? (
            <div className={GRID}>{FACET_DIMS.slice(0, 6).map((d) => <Skeleton key={d} className="h-36" />)}</div>
          ) : shown.length === 0 && folded.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <>
              {nothingLeft && (
                <div role="status" className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    {t("emptyAll")}
                    {emptied.length > 0 && <> {t("emptyFully", { dims: emptied.map((x) => t(`dims.${x.d}`)).join(", ") })}</>}
                  </span>
                  {emptied.slice(0, 3).map((x) => (
                    <Button key={x.d} variant="outline" size="sm" onClick={() => onChange({ ...view, off: { ...view.off, [x.d]: [] } })}>
                      {t("restoreDim", { dim: t(`dims.${x.d}`) })}
                    </Button>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => onChange(resetFacets(view))}><RotateCcw aria-hidden="true" />{t("resetAll")}</Button>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <GroupTabs groups={groups} active={current?.id ?? null} onPick={pickTab} view={view} />
                <TickerSearch q={q} onQ={setQ} />
              </div>
              {q.trim() ? (
                <TickerResults q={q.trim()} buckets={tickerBuckets} view={view} onChange={onChange} money={money} />
              ) : current && (
                <div
                  key={current.id}
                  role="tabpanel"
                  id={`facet-panel-${current.id}`}
                  aria-labelledby={`facet-tab-${current.id}`}
                  aria-busy={loading || undefined}
                  className={cn(GRID, "mt-3 animate-in fade-in-0 duration-150 motion-reduce:animate-none")}
                >
                  {current.cols.map((x) => <Column key={x.d} dim={x.d} buckets={x.buckets} view={view} onChange={onChange} money={money} />)}
                </div>
              )}
              {folded.length > 0 && (
                <p className="mt-3 text-2xs text-muted-foreground">
                  {t("single")}{" "}
                  {folded.map((x, i) => (
                    <span key={x.d}>{i > 0 && " · "}<span className="font-medium text-foreground/80">{t(`dims.${x.d}`)}</span> {x.buckets[0].label}</span>
                  ))}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
