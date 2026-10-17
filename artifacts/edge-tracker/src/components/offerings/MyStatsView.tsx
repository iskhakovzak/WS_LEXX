import { Link } from "wouter";
import { BarChart3, ServerCog } from "lucide-react";
import { DataTable, EmptyState, Panel, Pill, Segmented, SortableTh, StatCard, StatGrid, TermTooltip, UpdatedAgo, toneOf, usePersistentState, useTableSort } from "@/components/ds";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { MiniBar } from "./bits";
import { isMissingEndpoint, useMyOfferingStats } from "./use-offerings-data";
import { fmtDay, type DayBucket } from "./types";
import { fmtUsd, pluralRu } from "@/lib/format";

const wr = (b: DayBucket | undefined) => (b?.winRate != null ? `${Math.round(b.winRate)}%` : "—");

function BucketRow({ label, b, onClick }: { label: React.ReactNode; b: DayBucket; onClick?: () => void }) {
  return (
    <tr onClick={onClick} className={cn(onClick && "cursor-pointer")}>
      <td className="font-medium text-foreground">{label}</td>
      <td className="text-right">{b.trades}</td>
      <td className={cn("text-right", b.net > 0 ? "text-up" : b.net < 0 ? "text-down" : "")}>{fmtUsd(b.net, { signed: true, compact: true })}</td>
      <td className="text-right">{wr(b)}</td>
      <td className="text-right text-muted-foreground">{fmtUsd(b.avgNet, { signed: true, compact: true })}</td>
    </tr>
  );
}

type TickerBucket = DayBucket & { ticker: string; days: string[] };
type TickerKey = "ticker" | "trades" | "net" | "wr" | "avg";
const TICKER_ACCESSORS: Record<TickerKey, (b: TickerBucket) => number | string | null> = {
  ticker: (b) => b.ticker,
  trades: (b) => b.trades,
  net: (b) => b.net,
  wr: (b) => b.winRate,
  avg: (b) => b.avgNet,
};

function ByTickerTable({ rows, onOpenTicker }: { rows: TickerBucket[]; onOpenTicker: (t: string) => void }) {
  const { rows: sorted, thProps } = useTableSort(rows, TICKER_ACCESSORS, "net");
  return (
    <DataTable maxHeight="70dvh" ariaLabel="Мои сделки по тикерам в дни размещений">
      <table>
        <thead>
          <tr>
            <SortableTh {...thProps("ticker")}>Тикер</SortableTh>
            <SortableTh {...thProps("trades")} align="right">Сделок</SortableTh>
            <SortableTh {...thProps("net")} align="right">Net</SortableTh>
            <SortableTh {...thProps("wr")} align="right">WR</SortableTh>
            <SortableTh {...thProps("avg")} align="right">Ср.</SortableTh>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => (
            <BucketRow key={t.ticker} b={t} onClick={() => onOpenTicker(t.ticker)}
              label={<span className="inline-flex items-center gap-2">{t.ticker}<span className="text-2xs font-normal text-muted-foreground" title={t.days.map((d) => fmtDay(d)).join(", ")}>{t.days.slice(0, 2).map((d) => fmtDay(d)).join(", ")}{t.days.length > 2 ? ` +${t.days.length - 2}` : ""}</span></span>} />
          ))}
        </tbody>
      </table>
    </DataTable>
  );
}

/**
 * The trader's own results on days the traded ticker had a priced offering vs all other days.
 * Trades come from the journal (PropReports), offering days from SEC submissions.
 */
export function MyStatsView({ onOpenTicker }: { onOpenTicker: (t: string) => void }) {
  const [win, setWin] = useWindow();
  const q = useMyOfferingStats(win, true);
  const s = q.data;

  if (isMissingEndpoint(q.error)) {
    return (
      <Panel>
        <EmptyState icon={ServerCog} title="Статистика появится после обновления сервера"
          description="Сравнение «дни размещений / обычные дни» считается на сервере по SEC и вашим сделкам. Нужна пересборка API." />
      </Panel>
    );
  }
  if (q.error) {
    return <Panel><EmptyState icon={BarChart3} title="Не удалось посчитать статистику" description={q.error instanceof Error ? q.error.message : undefined} /></Panel>;
  }

  const off = s?.offering;
  const norm = s?.normal;
  const pending = s?.coverage.pending ?? 0;
  const diffWr = off?.winRate != null && norm?.winRate != null ? off.winRate - norm.winRate : null;
  const empty = s && s.coverage.trades === 0;

  return (
    <div className="flex min-w-0 flex-col gap-[var(--grid-gap)]">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented<"0" | "1">
          ariaLabel="Окно дня размещения"
          size="sm"
          value={String(win) as "0" | "1"}
          onChange={(v) => setWin(v === "1" ? 1 : 0)}
          options={[{ value: "0", label: "День сделки" }, { value: "1", label: "+ следующая сессия" }]}
        />
        <span className="text-xs text-muted-foreground">
          {s ? `SEC проверено ${s.coverage.covered} из ${s.coverage.tickers} ${pluralRu(s.coverage.tickers, "тикера", "тикеров", "тикеров")} · ${s.coverage.trades} ${pluralRu(s.coverage.trades, "сделка", "сделки", "сделок")}` : "Сверяем ваши тикеры с SEC…"}
        </span>
        {pending > 0 && <MiniBar value={s!.coverage.covered} max={s!.coverage.tickers} className="w-32" label="Прогресс проверки SEC" />}
        {s && <UpdatedAgo at={s.fetchedAt} className="ml-auto" />}
      </div>

      {empty ? (
        <Panel><EmptyState icon={BarChart3} title="Сделок пока нет" description="Как только сделки появятся в журнале, здесь будет сравнение дней размещений с обычными." /></Panel>
      ) : (
        <>
          <StatGrid min="12rem">
            <StatCard loading={!s} label="Net в дни размещений" value={off ? fmtUsd(off.net, { signed: true, compact: true }) : "—"} tone={toneOf(off?.net)}
              hint={off ? `${off.trades} ${pluralRu(off.trades, "сделка", "сделки", "сделок")} · ${off.tickers} ${pluralRu(off.tickers, "тикер", "тикера", "тикеров")}` : undefined} />
            <StatCard loading={!s} label="Win rate в дни размещений" value={wr(off)}
              delta={diffWr != null ? `${diffWr > 0 ? "+" : ""}${Math.round(diffWr)} п.п. к обычным` : undefined}
              deltaTone={diffWr == null ? "neutral" : diffWr >= 0 ? "up" : "down"} term="winrate" />
            <StatCard loading={!s} label="Net в обычные дни" value={norm ? fmtUsd(norm.net, { signed: true, compact: true }) : "—"} tone={toneOf(norm?.net)}
              hint={norm ? `${norm.trades} ${pluralRu(norm.trades, "сделка", "сделки", "сделок")} · WR ${wr(norm)}` : undefined} />
            <StatCard loading={!s} label="Средняя сделка: размещение / обычный"
              value={off && norm ? <span className="text-xl">{fmtUsd(off.avgNet, { signed: true, compact: true })} <span className="text-muted-foreground">/</span> {fmtUsd(norm.avgNet, { signed: true, compact: true })}</span> : "—"}
              hint="net на сделку" />
          </StatGrid>

          {s && s.excludedWksi.length > 0 && (
            <p className="text-xs text-muted-foreground" title={s.excludedWksi.join(", ")}>
              Не учтены {s.excludedWksi.length} крупных эмитентов с автоматическим шелфом (мкап ≥ $30B): их 424B5 — в основном облигации, не <TermTooltip term="dilution">разводнение</TermTooltip>.
            </p>
          )}

          <div className="grid min-w-0 items-start gap-[var(--grid-gap)] xl:grid-cols-2">
            <Panel title="По тикерам" description="Где вы торговали в дни их размещений" padded={false} bodyClassName="p-2">
              {!s ? <div className="skeleton m-2 h-48 rounded-xl" /> : s.byTicker.length === 0 ? (
                <EmptyState compact icon={BarChart3} title={pending > 0 ? "Ещё проверяем SEC…" : "Сделок в дни размещений нет"} />
              ) : (
                <ByTickerTable rows={s.byTicker} onOpenTicker={onOpenTicker} />
              )}
            </Panel>

            <div className="flex min-w-0 flex-col gap-[var(--grid-gap)]">
              <Panel title="По типу заявки" padded={false} bodyClassName="p-2">
                {!s ? <div className="skeleton m-2 h-24 rounded-xl" /> : s.byForm.length === 0 ? (
                  <EmptyState compact icon={BarChart3} title="Нет данных" />
                ) : (
                  <DataTable>
                    <table>
                      <thead><tr><th>Форма</th><th className="text-right">Сделок</th><th className="text-right">Net</th><th className="text-right">WR</th><th className="text-right">Ср.</th></tr></thead>
                      <tbody>
                        {s.byForm.map((f) => (
                          <BucketRow key={f.form} b={f} label={<span title={f.form === "424B4" ? "Андеррайтинговое размещение (IPO / SPO)" : f.form === "424B5" ? "Сделка с шелфа (SPO / direct / ATM)" : f.form === "424B7" ? "Перепродажа акционерами" : undefined}>{f.form}</span>} />
                        ))}
                      </tbody>
                    </table>
                  </DataTable>
                )}
              </Panel>

              <Panel title="Последние сделки в дни размещений" padded={false} bodyClassName="p-2">
                {!s ? <div className="skeleton m-2 h-40 rounded-xl" /> : s.recent.length === 0 ? (
                  <EmptyState compact icon={BarChart3} title="Пока нет" />
                ) : (
                  <ul className="max-h-[60dvh] divide-y divide-border/50 overflow-y-auto text-sm">
                    {s.recent.map((t) => (
                      <li key={t.id}>
                        <Link href={links.trade(t.id)} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-[var(--glass-hover-bg)]">
                          <span className="w-20 shrink-0 tabular-nums text-muted-foreground">{fmtDay(t.date, { day: "numeric", month: "short", year: "2-digit" })}</span>
                          <span className="font-medium text-foreground">{t.ticker}</span>
                          {t.form && <Pill tone="purple" className="px-1.5 text-2xs">{t.form}</Pill>}
                          {t.offeringDay !== t.date && <span className="text-2xs text-muted-foreground">день после</span>}
                          <span className={cn("ml-auto tabular-nums", t.net == null ? "text-muted-foreground" : t.net >= 0 ? "text-up" : "text-down")}>{fmtUsd(t.net, { signed: true, compact: true })}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function useWindow() {
  const [w, setW] = usePersistentState<0 | 1>("offerings.mystats.window", 0);
  return [w === 1 ? 1 : 0, setW] as const;
}
