import React, { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Radar, RefreshCw, ArrowUpRight, ArrowDownRight, Repeat2 } from "lucide-react";
import { useSectors, type SectorPoint } from "@/lib/market-intel";
import { BASE } from "@/lib/api";
import { Segmented, Pill, EmptyState, TermTooltip } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  WidgetShell,
  IconAction,
  WidgetError,
  heatBg,
  fmtPct,
  clockTime,
  useStoredState,
} from "@/components/widgets/widget-kit";

type SortKey = "day" | "week" | "alpha";
type View = "strip" | "bars";
const SORTS = ["day", "week", "alpha"] as const;
const VIEWS = ["strip", "bars"] as const;

const NAME_RU: Record<string, string> = {
  Technology: "Технологии",
  Semiconductors: "Полупроводники",
  Financials: "Финансы",
  Energy: "Энергетика",
  Healthcare: "Здравоохранение",
  Biotech: "Биотех",
  Industrials: "Промышленность",
  "Consumer Discretionary": "Потреб. циклич.",
  "Consumer Staples": "Потреб. базовые",
  Utilities: "Коммуналка",
  "Real Estate": "Недвижимость",
  Materials: "Материалы",
  Communication: "Коммуникации",
  "Communication Services": "Коммуникации",
  "Regional Banks": "Регион. банки",
  Retail: "Ритейл",
};
const ruName = (n: string) => NAME_RU[n] ?? n;

/** Day move against the 5-day trend: a sector bouncing after a sell-off (or fading after a run). */
function rotation(s: SectorPoint): "up" | "down" | null {
  if (s.changePct == null || s.trend5d == null) return null;
  if (s.changePct >= 0.5 && s.trend5d <= -1) return "up";
  if (s.changePct <= -0.5 && s.trend5d >= 1) return "down";
  return null;
}

function StripCell({ s, metric, rank }: { s: SectorPoint; metric: "day" | "week"; rank?: "top" | "bottom" }) {
  const v = metric === "week" ? s.trend5d : s.changePct;
  const other = metric === "week" ? s.changePct : s.trend5d;
  const rot = rotation(s);
  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-col justify-between gap-1 rounded-xl px-2.5 py-2 motion-safe:transition-colors motion-safe:duration-200",
        rank === "top" && "ring-1 ring-up/60",
        rank === "bottom" && "ring-1 ring-down/60",
      )}
      style={{ background: heatBg(v, metric === "week" ? 5 : 2.5) }}
      title={`${s.symbol} · ${ruName(s.name)} — день ${fmtPct(s.changePct)}, 5 дней ${fmtPct(s.trend5d)}`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-sm font-semibold">{s.symbol}</span>
        {rot && (
          <Repeat2
            className={cn("h-3.5 w-3.5", rot === "up" ? "text-up" : "text-down")}
            aria-label={rot === "up" ? "Разворот вверх против 5-дневного тренда" : "Разворот вниз против 5-дневного тренда"}
          />
        )}
      </div>
      <div className="truncate text-2xs text-foreground/80">{ruName(s.name)}</div>
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-sm font-semibold tabular-nums">{fmtPct(v)}</span>
        <span className="text-2xs tabular-nums text-foreground/75">{metric === "week" ? "д " : "5д "}{fmtPct(other, 1)}</span>
      </div>
    </div>
  );
}

function BarRow({ s, max, metric }: { s: SectorPoint; max: number; metric: "day" | "week" }) {
  const v = metric === "week" ? s.trend5d : s.changePct;
  const w = v == null ? 0 : Math.min(Math.abs(v) / (max || 1), 1) * 50;
  const rot = rotation(s);
  return (
    <li className="grid grid-cols-[3.25rem_minmax(0,1fr)_4rem] items-center gap-2 py-1 sm:grid-cols-[3.25rem_8.5rem_minmax(0,1fr)_4rem]">
      <span className="text-sm font-semibold">{s.symbol}</span>
      <span className="hidden truncate text-xs text-muted-foreground sm:block">{ruName(s.name)}</span>
      <div className="relative h-4" aria-hidden="true">
        <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
        {v != null && (
          <span
            className={cn("absolute inset-y-0.5 rounded-full motion-safe:transition-[width] motion-safe:duration-300", v >= 0 ? "bg-up/70" : "bg-down/70")}
            style={v >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }}
          />
        )}
      </div>
      <span className={cn("flex items-center justify-end gap-1 text-sm font-medium tabular-nums", v == null ? "text-muted-foreground" : v >= 0 ? "text-up" : "text-down")}>
        {rot && <Repeat2 className="h-3 w-3" aria-label="Разворот против 5-дневного тренда" />}
        {fmtPct(v)}
      </span>
    </li>
  );
}

export function SectorRadar() {
  const { data, isLoading, error, refetch, isFetching } = useSectors();
  const qc = useQueryClient();
  const [sort, setSort] = useStoredState<SortKey>("sector_radar_sort", "day", SORTS);
  const [view, setView] = useStoredState<View>("sector_radar_view", "strip", VIEWS);
  const [forcing, setForcing] = useState(false);
  const [forceError, setForceError] = useState<string | null>(null);

  const sectors = data?.sectors ?? [];
  const metric: "day" | "week" = sort === "week" ? "week" : "day";

  const sorted = useMemo(() => {
    const arr = [...sectors];
    if (sort === "alpha") return arr.sort((a, b) => a.symbol.localeCompare(b.symbol));
    const key = (s: SectorPoint) => (sort === "week" ? s.trend5d : s.changePct) ?? -Infinity;
    return arr.sort((a, b) => key(b) - key(a));
  }, [sectors, sort]);

  const breadth = useMemo(() => {
    const valid = sectors.filter((s) => s.changePct != null);
    const up = valid.filter((s) => (s.changePct ?? 0) > 0).length;
    const down = valid.filter((s) => (s.changePct ?? 0) < 0).length;
    const avg = valid.length ? valid.reduce((a, s) => a + (s.changePct ?? 0), 0) / valid.length : null;
    const byDay = [...valid].sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0));
    const rotations = sectors.filter((s) => rotation(s) != null);
    return { up, down, total: valid.length, avg, leader: byDay[0], laggard: byDay.length > 1 ? byDay[byDay.length - 1] : undefined, rotations };
  }, [sectors]);

  const maxAbs = useMemo(
    () => Math.max(0.5, ...sectors.map((s) => Math.abs((metric === "week" ? s.trend5d : s.changePct) ?? 0))),
    [sectors, metric],
  );

  async function forceRefresh() {
    setForcing(true);
    setForceError(null);
    try {
      const r = await fetch(`${BASE}/api/sectors?force=1`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      qc.setQueryData(["sectors"], await r.json());
    } catch {
      setForceError("Не удалось обновить котировки");
      refetch();
    } finally {
      setForcing(false);
    }
  }

  const showSkeleton = isLoading && sectors.length === 0;
  const showError = !!error && sectors.length === 0;

  return (
    <WidgetShell
      icon={Radar}
      title="Сила секторов"
      meta={data?.fetchedAt ? `на ${clockTime(data.fetchedAt)}` : undefined}
      actions={
        <>
          <Segmented<View>
            ariaLabel="Вид"
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: "strip", label: "Карта" },
              { value: "bars", label: "Рейтинг" },
            ]}
          />
          <IconAction icon={RefreshCw} label="Обновить котировки секторов" spinning={forcing || isFetching} disabled={forcing} onClick={forceRefresh} />
        </>
      }
    >
      {showSkeleton ? (
        <div className="space-y-3" aria-busy="true" aria-label="Загрузка секторов">
          <Skeleton className="h-6 w-full rounded-full" />
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="h-[68px] rounded-xl" />
            ))}
          </div>
        </div>
      ) : showError ? (
        <WidgetError message="Не удалось загрузить секторы" onRetry={() => refetch()} />
      ) : sectors.length === 0 ? (
        <EmptyState icon={Radar} title="Нет данных по секторам" description="Котировки секторных ETF появятся после первого обновления." className="py-6" />
      ) : (
        <div className="space-y-3">
          {/* Breadth summary */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-[10rem] flex-1">
              <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-2">
                  <TermTooltip term="breadth" className="text-muted-foreground" />
                  <span className="text-up tabular-nums">Растут {breadth.up}</span>
                </span>
                <span className="text-down tabular-nums">Падают {breadth.down}</span>
              </div>
              <div className="flex h-1.5 overflow-hidden rounded-full bg-foreground/[0.06]" role="img" aria-label={`Растут ${breadth.up} из ${breadth.total}, падают ${breadth.down}`}>
                <span className="bg-up/80" style={{ width: `${breadth.total ? (breadth.up / breadth.total) * 100 : 0}%` }} />
                <span className="flex-1" />
                <span className="bg-down/80" style={{ width: `${breadth.total ? (breadth.down / breadth.total) * 100 : 0}%` }} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <Pill tone={breadth.avg == null ? "neutral" : breadth.avg >= 0 ? "up" : "down"}>Среднее {fmtPct(breadth.avg)}</Pill>
              {breadth.leader && (
                <Pill tone="up">
                  <ArrowUpRight className="h-3 w-3" aria-hidden="true" /> {breadth.leader.symbol} {fmtPct(breadth.leader.changePct, 1)}
                </Pill>
              )}
              {breadth.laggard && (
                <Pill tone="down">
                  <ArrowDownRight className="h-3 w-3" aria-hidden="true" /> {breadth.laggard.symbol} {fmtPct(breadth.laggard.changePct, 1)}
                </Pill>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented<SortKey>
              ariaLabel="Сортировка секторов"
              size="sm"
              value={sort}
              onChange={setSort}
              options={[
                { value: "day", label: "За день" },
                { value: "week", label: "За 5 дней" },
                { value: "alpha", label: "А–Я" },
              ]}
            />
            {breadth.rotations.length > 0 && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Repeat2 className="h-3.5 w-3.5" aria-hidden="true" />
                Разворот: {breadth.rotations.map((s) => s.symbol).join(", ")}
              </span>
            )}
          </div>

          {forceError && <WidgetError message={forceError} />}

          {view === "strip" ? (
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
              {sorted.map((s) => (
                <StripCell
                  key={s.symbol}
                  s={s}
                  metric={metric}
                  rank={s.symbol === breadth.leader?.symbol ? "top" : s.symbol === breadth.laggard?.symbol ? "bottom" : undefined}
                />
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-border/50">
              {sorted.map((s) => (
                <BarRow key={s.symbol} s={s} max={maxAbs} metric={metric} />
              ))}
            </ul>
          )}

          <p className="text-2xs text-muted-foreground">
            Цвет — сила движения {metric === "week" ? "за 5 дней" : "за день"}. <Repeat2 className="inline h-3 w-3 align-[-2px]" aria-hidden="true" /> — день идёт против 5-дневного тренда.
          </p>
        </div>
      )}
    </WidgetShell>
  );
}
