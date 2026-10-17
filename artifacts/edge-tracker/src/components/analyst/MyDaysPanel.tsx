/**
 * «Мои сделки в дни рейтингов»: net / WR of my trades on a ticker on the day the market reacts to an analyst
 * action vs normal days. Answers «стоит ли мне вообще торговать апгрейды/даунгрейды».
 */
import * as React from "react";
import { UserRound } from "lucide-react";
import { EmptyState, Panel, TermTooltip } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { DayBucket, MyDaysResponse } from "./api";
import { fmtUsd } from "@/lib/format";

const MIN_TRADES = 5;

function BucketRow({ label, b, hint, strong }: { label: React.ReactNode; b: DayBucket; hint?: string; strong?: boolean }) {
  const wr = b.winRate != null ? Math.round(b.winRate * 100) : null;
  return (
    <tr className={cn(strong && "font-medium")}>
      <th scope="row" className="py-1.5 pr-2 text-left text-xs font-normal text-muted-foreground" title={hint}>{label}</th>
      <td className="py-1.5 text-right text-xs tabular-nums text-foreground">{b.trades}</td>
      <td className={cn("py-1.5 text-right text-xs tabular-nums", b.trades ? (b.net >= 0 ? "text-up" : "text-down") : "text-muted-foreground")}>
        {b.trades ? fmtUsd(b.net, { signed: true, decimals: "auto" }) : "—"}
      </td>
      <td className="py-1.5 text-right text-xs tabular-nums text-foreground">{wr != null ? `${wr}%` : "—"}</td>
      <td className={cn("py-1.5 text-right text-xs tabular-nums", b.avgNet == null ? "text-muted-foreground" : b.avgNet >= 0 ? "text-up" : "text-down")}>
        {b.avgNet != null ? fmtUsd(b.avgNet, { signed: true, decimals: "auto" }) : "—"}
      </td>
    </tr>
  );
}

function insight(d: MyDaysResponse): string | null {
  const { rating, none, withCall, againstCall } = d.buckets;
  const parts: string[] = [];
  if (rating.trades >= MIN_TRADES && none.trades >= MIN_TRADES && rating.avgNet != null && none.avgNet != null) {
    const diff = rating.avgNet - none.avgNet;
    if (Math.abs(diff) >= 1) {
      parts.push(
        diff > 0
          ? `В дни смены рейтинга сделка в среднем приносит на ${fmtUsd(diff, { decimals: "auto" })} больше, чем в обычные дни.`
          : `В дни смены рейтинга сделка в среднем на ${fmtUsd(-diff, { decimals: "auto" })} хуже обычного — осторожнее с такими тикерами.`,
      );
    }
  }
  if (withCall.trades >= MIN_TRADES && againstCall.trades >= MIN_TRADES && withCall.avgNet != null && againstCall.avgNet != null) {
    parts.push(
      withCall.avgNet >= againstCall.avgNet
        ? "По направлению рейтинга получается лучше, чем против него."
        : "Против рейтинга получается лучше, чем по его направлению.",
    );
  }
  return parts.length ? parts.join(" ") : null;
}

export function MyDaysPanel({
  data, isLoading, scopeLabel,
}: {
  data: MyDaysResponse | null | undefined;
  isLoading: boolean;
  scopeLabel: string;
}) {
  const text = data ? insight(data) : null;
  const total = data ? data.buckets.rating.trades + data.buckets.target.trades + data.buckets.none.trades : 0;
  return (
    <Panel
      icon={UserRound}
      title={
        <span className="inline-flex items-center gap-1.5">
          Мои сделки в дни рейтингов
          <TermTooltip term="reactionDay" icon />
        </span>
      }
      description={data ? `${scopeLabel} · ${data.days} дн · ${total} сделок` : scopeLabel}
      bodyClassName="min-h-[176px]"
    >
      {isLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-7 w-full rounded-lg" />)}
        </div>
      ) : data === null ? (
        <p className="text-xs text-muted-foreground">Статистика появится после обновления API.</p>
      ) : !data || total === 0 ? (
        <EmptyState compact icon={UserRound} title="Нет закрытых сделок за год" description="Статистика появится после первых сделок." />
      ) : (
        <div className="flex flex-col gap-3">
          <table className="w-full table-fixed border-separate border-spacing-0">
            <colgroup>
              <col />
              <col style={{ width: 40 }} />
              <col style={{ width: 78 }} />
              <col style={{ width: 44 }} />
              <col style={{ width: 66 }} />
            </colgroup>
            <thead>
              <tr className="text-2xs text-muted-foreground">
                <th scope="col" className="pb-1 text-left font-medium">День</th>
                <th scope="col" className="pb-1 text-right font-medium">Сд.</th>
                <th scope="col" className="pb-1 text-right font-medium"><TermTooltip term="net" /></th>
                <th scope="col" className="pb-1 text-right font-medium"><TermTooltip term="winrate">WR</TermTooltip></th>
                <th scope="col" className="pb-1 text-right font-medium">Ср.</th>
              </tr>
            </thead>
            <tbody className="[&_tr+tr_th]:border-t [&_tr+tr_td]:border-t [&_th]:border-border/50 [&_td]:border-border/50">
              <BucketRow label="Смена рейтинга" b={data.buckets.rating} hint="Апгрейд, даунгрейд или начало покрытия в день реакции" strong />
              <BucketRow label="Только таргет" b={data.buckets.target} hint="Было лишь обновление целевой цены" />
              <BucketRow label="Обычный день" b={data.buckets.none} hint="Никаких действий аналитиков по тикеру" />
              {data.buckets.withCall.trades + data.buckets.againstCall.trades > 0 && (
                <>
                  <BucketRow label={<TermTooltip term="ratingHit">По рейтингу</TermTooltip>} b={data.buckets.withCall} hint="Лонг после апгрейда, шорт после даунгрейда" />
                  <BucketRow label="Против рейтинга" b={data.buckets.againstCall} hint="Шорт после апгрейда, лонг после даунгрейда" />
                </>
              )}
            </tbody>
          </table>
          {text ? (
            <p className="rounded-lg bg-[var(--glass-bg)] px-2.5 py-2 text-xs text-foreground">{text}</p>
          ) : data.buckets.rating.trades < MIN_TRADES ? (
            <p className="text-xs text-muted-foreground">Мало сделок в дни рейтингов ({data.buckets.rating.trades}) — вывода пока нет.</p>
          ) : null}
        </div>
      )}
    </Panel>
  );
}
