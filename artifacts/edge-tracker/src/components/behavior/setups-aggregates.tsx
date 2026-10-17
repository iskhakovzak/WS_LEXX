/**
 * Агрегаты по сетапу: ожидание $ на сделку с 95% бутстрап-интервалом, win rate с интервалом Уилсона, PF, n.
 * n < 20 помечается — выводы ненадёжны. Вердикт учитывает интервал: «edge» только если весь интервал > 0.
 */
import * as React from "react";
import { Link } from "wouter";
import { Layers } from "lucide-react";
import { DataTable, EmptyState, Pill, SortableTh, toneOf, toneText, useTableSort, type Tone } from "@/components/ds";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { winRateTone, type SetupAggregate } from "./api";
import { fmtRate, fmtRatio, fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";

const ACCESSORS = {
  setup: (r: SetupAggregate) => r.setup,
  n: (r: SetupAggregate) => r.n,
  winRate: (r: SetupAggregate) => r.winRate,
  net: (r: SetupAggregate) => r.net,
  expectancy: (r: SetupAggregate) => r.expectancy,
  profitFactor: (r: SetupAggregate) => r.profitFactor,
  avgConfidence: (r: SetupAggregate) => r.avgConfidence,
} as const;

function verdict(g: SetupAggregate, smallN: number): { label: string; tone: Tone; title: string } {
  if (g.n < 5) return { label: "мало данных", tone: "neutral", title: "Меньше 5 сделок" };
  const ci = g.expectancyCI;
  if (ci && ci.low > 0) return { label: "edge", tone: "up", title: "Весь 95% интервал ожидания выше нуля" };
  if (ci && ci.high < 0) return { label: "утечка", tone: "down", title: "Весь 95% интервал ожидания ниже нуля" };
  if (g.expectancy != null && g.expectancy > 0) return { label: g.n < smallN ? "плюс, n мало" : "плюс, не значимо", tone: "neutral", title: "Ожидание положительное, но интервал захватывает ноль" };
  if (g.expectancy != null && g.expectancy < 0) return { label: g.n < smallN ? "минус, n мало" : "минус, не значимо", tone: "neutral", title: "Ожидание отрицательное, но интервал захватывает ноль" };
  return { label: "около нуля", tone: "neutral", title: "" };
}

/** Горизонтальная шкала интервала: точка — оценка, полоса — 95% интервал, вертикаль — ноль. */
function CiBar({ value, ci, lo, hi }: { value: number | null; ci: { low: number; high: number } | null | undefined; lo: number; hi: number }) {
  if (value == null) return null;
  const span = hi - lo || 1;
  const pos = (v: number) => `${((Math.min(hi, Math.max(lo, v)) - lo) / span) * 100}%`;
  const tone = ci ? (ci.low > 0 ? "bg-up" : ci.high < 0 ? "bg-down" : "bg-muted-foreground") : "bg-muted-foreground";
  return (
    <span className="relative mt-1 block h-2 w-full min-w-[6rem]" aria-hidden="true">
      <span className="absolute inset-y-0 w-px bg-border" style={{ left: pos(0) }} />
      {ci && <span className={cn("absolute top-[3px] h-0.5 rounded-full opacity-60", tone)} style={{ left: pos(ci.low), right: `calc(100% - ${pos(ci.high)})` }} />}
      <span className={cn("absolute top-0 h-2 w-2 -translate-x-1/2 rounded-full", tone)} style={{ left: pos(value) }} />
    </span>
  );
}

export function SetupsAggregates({ groups, covered, pending, smallSample = 20 }: { groups: SetupAggregate[]; covered: number; pending: number; smallSample?: number }) {
  const { rows, thProps } = useTableSort(groups, ACCESSORS, "net");
  const [lo, hi] = React.useMemo(() => {
    const xs = groups.flatMap((g) => (g.expectancyCI ? [g.expectancyCI.low, g.expectancyCI.high] : g.expectancy != null ? [g.expectancy] : []));
    const m = Math.max(1, ...xs.map(Math.abs));
    return [-m, m];
  }, [groups]);

  if (!groups.length) {
    return <EmptyState icon={Layers} title="Пока нет предложений" description={pending > 0 ? `Не посчитано ${commonI18n.t("units.trades", { count: pending })} — нажмите «Посчитать всё».` : "Нет закрытых сделок за период."} />;
  }
  return (
    <div className="flex flex-col gap-2">
      <DataTable maxHeight="56vh" ariaLabel="Агрегаты по сетапу">
        <table>
          <thead>
            <tr>
              <SortableTh {...thProps("setup")}>Сетап</SortableTh>
              <SortableTh {...thProps("n")} align="right">n</SortableTh>
              <SortableTh {...thProps("expectancy")} align="right">Ожидание / сделку · 95% ДИ</SortableTh>
              <SortableTh {...thProps("winRate")} align="right">Win rate · 95% ДИ</SortableTh>
              <SortableTh {...thProps("net")} align="right">Нетто</SortableTh>
              <SortableTh {...thProps("profitFactor")} align="right">PF</SortableTh>
              <SortableTh {...thProps("avgConfidence")} align="right">Уверенность</SortableTh>
              <th scope="col">Вердикт</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => {
              const v = verdict(g, smallSample);
              const small = g.small ?? g.n < smallSample;
              const decided = g.wins + g.losses;
              return (
                <tr key={g.setup}>
                  <td className="font-medium">
                    {g.accepted > 0 ? (
                      <Link href={links.trades({ setup: g.setup })} className="underline-offset-2 hover:underline" title={`Принято в ${commonI18n.t("units.trades", { count: g.accepted })} — открыть в журнале`}>{g.setup}</Link>
                    ) : g.setup}
                    {g.accepted > 0 && <span className="ml-1 text-xs font-normal text-muted-foreground">принято {g.accepted}</span>}
                  </td>
                  <td className="text-right tabular-nums">
                    {g.n}
                    {small && <Pill tone="neutral" className="ml-1" title={`Меньше ${smallSample} сделок: интервалы широкие, выводы ненадёжны`}>n&lt;{smallSample}</Pill>}
                  </td>
                  <td className="text-right tabular-nums" title={g.expectancyCI ? `95% бутстрап-интервал: ${fmtUsd(g.expectancyCI.low, { signed: true, decimals: "auto" })} … ${fmtUsd(g.expectancyCI.high, { signed: true, decimals: "auto" })}` : "Интервал не определён (n < 2)"}>
                    <span className={toneText(toneOf(g.expectancy))}>{fmtUsd(g.expectancy, { signed: true, decimals: "auto" })}</span>
                    {g.expectancyCI && <span className="ml-1 text-xs text-muted-foreground">[{fmtUsd(g.expectancyCI.low, { signed: true, compact: true })}; {fmtUsd(g.expectancyCI.high, { signed: true, compact: true })}]</span>}
                    <CiBar value={g.expectancy} ci={g.expectancyCI} lo={lo} hi={hi} />
                  </td>
                  <td className="text-right tabular-nums" title={g.winRateCI ? `Интервал Уилсона: ${fmtRate(g.winRateCI.low)} … ${fmtRate(g.winRateCI.high)} (W/(W+L), BE не считаются)` : undefined}>
                    <span className={toneText(winRateTone(g.winRate, decided))}>{fmtRate(g.winRate)}</span>
                    {g.winRateCI && <span className="ml-1 text-xs text-muted-foreground">[{fmtRate(g.winRateCI.low)}–{fmtRate(g.winRateCI.high)}]</span>}
                    <div className="text-xs text-muted-foreground">{g.wins}/{g.losses}{g.be ? `/${g.be}` : ""}</div>
                  </td>
                  <td className={cn("text-right tabular-nums", toneText(toneOf(g.net)))}>{fmtUsd(g.net, { signed: true, decimals: "auto" })}</td>
                  <td className="text-right tabular-nums" title={g.profitFactor == null ? "PF не определён: нет убыточных сделок или нет P&L" : undefined}>{fmtRatio(g.profitFactor)}</td>
                  <td className="text-right tabular-nums">{g.avgConfidence == null ? "—" : `${Math.round(g.avgConfidence * 100)}%`}</td>
                  <td><Pill tone={v.tone} dot title={v.title}>{v.label}</Pill></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </DataTable>
      <p className="text-xs text-muted-foreground">
        Покрыто {commonI18n.t("units.trades", { count: covered })}{pending > 0 ? `, не посчитано ${pending}` : ""}. Ожидание — средний нетто на сделку, интервал — бутстрап 2000 выборок;
        win rate = W/(W+L) с интервалом Уилсона. «Edge»/«утечка» — только если весь интервал по одну сторону от нуля. Отклонённые предложения исключены.
      </p>
    </div>
  );
}
