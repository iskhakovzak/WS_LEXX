import { CalendarDays, LockOpen, Rocket } from "lucide-react";
import { EmptyState, Panel, Pill, UpdatedAgo } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SignedPct } from "./bits";
import { isMissingEndpoint, useIpoCalendar } from "./use-offerings-data";
import {
  fmtDay, fmtM, fmtPrice, fmtShares, todayNY,
  type IpoCalendarItem, type IpoQuoted, type IpoRow, type Offering,
} from "./types";

/** Turn a calendar row into an Offering so the same detail sheet can open it. */
export function calendarToOffering(c: IpoCalendarItem | IpoRow | IpoQuoted): Offering {
  const q = c as Partial<IpoQuoted>;
  return {
    ticker: c.ticker, company: c.company, type: "IPO", date: c.date,
    offerPrice: c.offerPrice, currentPrice: q.currentPrice ?? null,
    priceChangePct: q.pctFromIpo ?? null,
    dealSizeM: c.dealSizeM, sharesOffered: c.sharesOffered,
    sharesOutstandingBefore: null, sharesOutstandingAfter: null, dilutionPct: null,
    sellerType: "company", insiderShares: null, companyShares: c.sharesOffered,
    underwriter: (c as IpoRow).underwriter ?? null, lockupDays: c.status === "withdrawn" ? null : 180,
    volume: null, avgVolume: q.avgVolume ?? null, relVol: null, marketCapM: q.marketCapM ?? null, sector: null,
    rating: 50, ratingFactors: [],
    status: c.status === "filed" ? "filed" : c.status,
    source: "nasdaq", kind: "IPO", form: "IPO", exchange: c.exchange, priceRange: c.priceRange,
    dealFlags: [], riskFactors: [],
  };
}

function TickerBtn({ t, onClick, muted }: { t: string; onClick: () => void; muted?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={cn("rounded font-semibold hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", muted ? "text-muted-foreground line-through" : "text-foreground")}>
      {t}
    </button>
  );
}

function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-9 w-full rounded-lg" />)}
    </div>
  );
}

/**
 * IPO calendar and lock-up expirations side by side (one row at xl, stacked below).
 * Falls back to the IPO list from the day payload while the dedicated endpoint is not deployed.
 */
export function IpoLockupView({ fallback, onPick }: { fallback: IpoCalendarItem[]; onPick: (o: Offering) => void }) {
  const q = useIpoCalendar(true);
  const missing = isMissingEndpoint(q.error);
  const today = todayNY();
  const upcoming: IpoRow[] = q.data?.upcoming
    ?? fallback.filter((c) => c.status === "upcoming" && c.date >= today).map((c) => ({ ...c, underwriter: null }));
  const recent = q.data?.recent ?? [];
  const lockups = q.data?.lockups ?? [];
  const loading = q.isLoading;

  return (
    <div className="grid min-w-0 items-start gap-[var(--grid-gap)] xl:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-[var(--grid-gap)]">
        <Panel title="Ближайшие IPO" icon={CalendarDays}
          description={q.data ? "NASDAQ: ожидаемая дата оценки, диапазон цены" : "Из календаря NASDAQ"}
          actions={q.data ? <UpdatedAgo at={q.data.fetchedAt} /> : undefined}>
          {loading ? <ListSkeleton rows={4} /> : upcoming.length === 0 ? (
            <EmptyState compact icon={CalendarDays} title="IPO на ближайшие недели нет" description={q.data && !q.data.sources.nasdaq ? "NASDAQ не ответил — попробуйте позже." : "Календарь NASDAQ пуст."} />
          ) : (
            <ul className="divide-y divide-border/50 text-sm">
              {upcoming.slice(0, 20).map((c) => (
                <li key={`${c.ticker}-${c.date}`} className="flex items-center gap-3 py-1.5">
                  <span className="w-20 shrink-0 tabular-nums text-muted-foreground">{fmtDay(c.date, { weekday: "short", day: "numeric", month: "short" })}</span>
                  <TickerBtn t={c.ticker} onClick={() => onPick(calendarToOffering(c))} />
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={c.company}>{c.company}</span>
                  <span className="shrink-0 text-right text-xs tabular-nums text-foreground">{c.priceRange ? `$${c.priceRange}` : "—"}</span>
                  <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{fmtM(c.dealSizeM)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Недавние IPO, 30 дней" icon={Rocket} description="Цена против цены размещения">
          {loading ? <ListSkeleton rows={5} /> : missing ? (
            <EmptyState compact icon={Rocket} title="Нужно обновить сервер" description="Список недавних IPO и lock-up появится после пересборки API." />
          ) : recent.length === 0 ? (
            <EmptyState compact icon={Rocket} title="За 30 дней IPO не было" />
          ) : (
            <ul className="divide-y divide-border/50 text-sm">
              {recent.slice(0, 20).map((c) => (
                <li key={`${c.ticker}-${c.date}`} className="flex items-center gap-3 py-1.5">
                  <span className="w-16 shrink-0 tabular-nums text-muted-foreground">{fmtDay(c.date)}</span>
                  <TickerBtn t={c.ticker} onClick={() => onPick(calendarToOffering(c))} />
                  {c.spac && <Pill tone="neutral" className="px-1.5 text-2xs">SPAC</Pill>}
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={c.company}>{c.company}</span>
                  <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">{fmtPrice(c.offerPrice)} → {fmtPrice(c.currentPrice)}</span>
                  <span className="w-16 shrink-0 text-right text-xs"><SignedPct value={c.pctFromIpo} /></span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Окончание lock-up" icon={LockOpen}
        description="IPO + 180 дней: инсайдеры и фонды получают право продавать. Окно −7…+45 дней, SPAC исключены"
        actions={q.data ? <UpdatedAgo at={q.data.fetchedAt} /> : undefined}>
        {loading ? <ListSkeleton rows={8} /> : missing ? (
          <EmptyState compact icon={LockOpen} title="Нужно обновить сервер" description="Календарь lock-up считается на сервере — появится после пересборки API." />
        ) : lockups.length === 0 ? (
          <EmptyState compact icon={LockOpen} title="В окне нет окончаний lock-up" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-2 font-medium">Дата</th>
                  <th className="px-2 py-1.5 font-medium">Тикер</th>
                  <th className="px-2 py-1.5 text-right font-medium">IPO → сейчас</th>
                  <th className="px-2 py-1.5 text-right font-medium" title="Залоченные акции к размеру IPO (грубо: (в обращении − размещено) / размещено)">Разлок</th>
                  <th className="py-1.5 pl-2 text-right font-medium">Мкап</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {lockups.map((c) => {
                  const past = c.daysLeft < 0;
                  const soon = c.daysLeft >= 0 && c.daysLeft <= 5;
                  return (
                    <tr key={`${c.ticker}-${c.lockupDate}`} className={cn(past && "text-muted-foreground")}>
                      <td className="whitespace-nowrap py-1.5 pr-2">
                        {fmtDay(c.lockupDate, { day: "numeric", month: "short" })}
                        <span className={cn("ml-1.5 text-2xs", soon ? "font-medium text-[hsl(var(--chart-3))]" : "text-muted-foreground")}>
                          {past ? `${-c.daysLeft} дн назад` : c.daysLeft === 0 ? "сегодня" : `через ${c.daysLeft} дн`}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="inline-flex items-center gap-2">
                          <TickerBtn t={c.ticker} onClick={() => onPick(calendarToOffering(c))} />
                          <span className="hidden max-w-[10rem] truncate text-2xs text-muted-foreground sm:inline" title={c.company}>{c.company}</span>
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right text-xs">
                        <span className="text-muted-foreground">{fmtPrice(c.offerPrice)} → {fmtPrice(c.currentPrice)} </span>
                        <SignedPct value={c.pctFromIpo} />
                      </td>
                      <td className="px-2 py-1.5 text-right text-xs" title={c.sharesOffered ? `IPO: ${fmtShares(c.sharesOffered)} акций` : undefined}>
                        {c.unlockMultiple != null ? <span className={c.unlockMultiple >= 3 ? "text-down" : "text-foreground"}>{c.unlockMultiple}×</span> : "—"}
                      </td>
                      <td className="py-1.5 pl-2 text-right text-xs text-muted-foreground">{fmtM(c.marketCapM)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-2xs text-muted-foreground">Дата — оценка по стандартным 180 дням; точный срок — в проспекте (раздел Lock-up). Разлок ≥3× — много бумаги на рынок; IPO выше цены размещения — продавать есть что.</p>
          </div>
        )}
      </Panel>
    </div>
  );
}
