/**
 * «Деск на тикере» — one ticker-day with every desk trader's entries, adds, partial exits, exits and stops on one chart.
 * Route: /desk-day?ticker=XXX&date=YYYY-MM-DD[&alias=N] (links.deskDay). `alias` highlights that trader (the day alias
 * from the top of the day); otherwise the viewer's own trades. Entry points: the trade sheet, the day report, the evening
 * card, the top of the day.
 * Data: GET /api/desk-day/:ticker/:date (names / $ per the view: staff, anonymous, named) + the candle archive day.
 * «Позиция офиса»: the desk's net position layer on the chart + one summary line (toggle remembered per browser).
 */
import * as React from "react";
import { useLocation, useSearch } from "wouter";
import { Lock, Search, Users } from "lucide-react";
import { EmptyState, FilterChip, Page, PageHeader, Panel, usePersistentState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-error";
import { PlaybookSheetButton } from "@/components/shared/playbook-sheet";
import { DayStepper } from "@/components/shared/day-stepper";
import { useAuth } from "@/contexts/auth-context";
import { links } from "@/lib/links";
import { fmtDate, fmtDeskDate } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { cn } from "@/lib/utils";
import { nyDate } from "@/lib/trading-date";
import { deskDayI18n } from "@/i18n/ns/deskDay";
import { useDayCandles, useDeskDay, useDeskDayTop, type DeskDay, type DeskDayTop } from "@/components/desk-day/api";
import { DeskDayChart } from "@/components/desk-day/DeskDayChart";
import { DeskDayLegend, RoleKey } from "@/components/desk-day/DeskDayLegend";
import { clampEmptyWicks, defaultFocus, pickTakeaways, traderColors } from "@/components/desk-day/model";
import { officeSummary, takeawayText, traderLabel } from "@/components/desk-day/labels";

const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,10}$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function readParams(search: string): { ticker: string; date: string; alias: number | null } {
  const p = new URLSearchParams(search);
  const ticker = (p.get("ticker") ?? "").trim().toUpperCase();
  const date = p.get("date") ?? "";
  const alias = Number(p.get("alias"));
  return { ticker: TICKER_RE.test(ticker) ? ticker : "", date: YMD_RE.test(date) ? date : "", alias: Number.isInteger(alias) && alias > 0 ? alias : null };
}

function PickForm({ ticker, date, onGo }: { ticker: string; date: string; onGo: (ticker: string, date: string) => void }) {
  const { t } = deskDayI18n.useT();
  const [tk, setTk] = React.useState(ticker);
  const [d, setD] = React.useState(date || nyDate());
  React.useEffect(() => { setTk(ticker); }, [ticker]);
  React.useEffect(() => { if (date) setD(date); }, [date]);
  const valid = TICKER_RE.test(tk.trim().toUpperCase()) && YMD_RE.test(d);
  // The day (wave 3: the shared DayStepper, outside the <form> so its buttons never submit it) opens that day of the
  // shown ticker at once; a new ticker still goes through «Показать».
  const pickDay = (next: string) => {
    setD(next);
    const tkOk = TICKER_RE.test(tk.trim().toUpperCase());
    if (tkOk) onGo(tk.trim().toUpperCase(), next);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); if (valid) onGo(tk.trim().toUpperCase(), d); }}
      >
        <Input aria-label={t("form.ticker")} placeholder={t("form.ticker")} value={tk} onChange={(e) => setTk(e.target.value.toUpperCase())} className="h-9 w-28 rounded-full uppercase" maxLength={11} />
        <Button type="submit" size="sm" disabled={!valid}><Search className="h-4 w-4" aria-hidden="true" /> {t("form.show")}</Button>
      </form>
      <DayStepper value={d} onChange={pickDay} max={nyDate()} />
    </div>
  );
}

function DayView({ day, ticker, date, alias }: { day: DeskDay; ticker: string; date: string; alias: number | null }) {
  const { t } = deskDayI18n.useT();
  const candles = useDayCandles(ticker, date, day.traders.length > 0);
  const colors = React.useMemo(() => traderColors(day.traders), [day.traders]);
  const [focus, setFocus] = React.useState<string[]>(() => defaultFocus(day, alias));
  const key = `${ticker}|${date}|${alias ?? ""}`;
  const lastKey = React.useRef(key);
  React.useEffect(() => {
    if (lastKey.current !== key) { lastKey.current = key; setFocus(defaultFocus(day, alias)); }
  }, [key, day, alias]);
  const toggle = React.useCallback((name: string) => setFocus((f) => (f.includes(name) ? f.filter((x) => x !== name) : [...f, name])), []);
  const [showOfficeRaw, setShowOffice] = usePersistentState<boolean>("deskDay.office", true);
  const showOffice = showOfficeRaw !== false;
  const lines = pickTakeaways(day.takeaways).map((tk) => takeawayText(tk, (k) => traderLabel(day, k), (k) => !!day.traders.find((x) => x.name === k)?.me));
  const office = showOffice ? officeSummary(day) : null;
  const bars = React.useMemo(() => clampEmptyWicks(candles.data?.candles ?? []), [candles.data]);
  const baseSec = candles.data?.tf === "5m" ? 300 : candles.data?.tf === "15m" ? 900 : 60;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <Panel className="lg:col-span-8" bodyClassName="flex flex-col gap-3">
        {lines.length > 0 && (
          <p className="text-sm text-foreground">
            <span className="micro-label mr-2">{t("takeaway.label")}</span>
            {lines.join(" · ")}
          </p>
        )}
        {office && (
          <p className="text-sm text-foreground">
            <span className="micro-label mr-2">{t("office.toggle")}</span>
            {office}
          </p>
        )}
        {candles.isLoading ? (
          <Skeleton className={cn("rounded-xl", showOffice && day.office ? "h-[400px] sm:h-[540px]" : "h-[340px] sm:h-[460px]")} />
        ) : candles.isError && candles.error?.status !== 404 && !bars.length ? (
          <div className="flex h-[340px] items-center sm:h-[460px]"><QueryError error={candles.error} onRetry={() => void candles.refetch()} className="w-full" /></div>
        ) : bars.length ? (
          <DeskDayChart day={day} bars={bars} baseSec={baseSec} colors={colors} focus={focus} onToggle={toggle} showOffice={showOffice} onShowOffice={setShowOffice} prevClose={candles.data?.prevClose ?? null} />
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">{t("noCandles")}</p>
        )}
        <RoleKey day={day} />
      </Panel>
      <Panel className="lg:col-span-4" padded={false} bodyClassName="p-2 sm:p-3">
        <DeskDayLegend day={day} colors={colors} focus={focus} onToggle={toggle} onClear={() => setFocus([])} />
      </Panel>
    </div>
  );
}

/**
 * Prefill instead of an empty form (design audit wave 2): the desk's most traded tickers of its last trading day as
 * chips; the page opens the first one when no ticker is in the address. A click opens that ticker-day.
 */
function TopTickers({ top, ticker, date, onGo }: { top: DeskDayTop; ticker: string; date: string; onGo: (ticker: string, date: string) => void }) {
  const { t } = deskDayI18n.useT();
  if (!top.date || !top.items.length) return null;
  const day = fmtDeskDate(top.date, "weekdayDayMonth");
  return (
    <div role="group" aria-label={t("top.aria", { date: day })} className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-sm text-muted-foreground">{t("top.label", { date: day })}</span>
      {top.items.map((x) => (
        <FilterChip
          key={x.ticker}
          size="sm"
          active={x.ticker === ticker && top.date === date}
          count={x.traders}
          onClick={() => onGo(x.ticker, top.date!)}
          title={`${t("top.chipTitle", { traders: commonI18n.t("units.traders", { count: x.traders }), trades: commonI18n.t("units.trades", { count: x.trades }) })}${x.traded ? ` · ${t("top.mine")}` : ""}`}
        >
          {x.ticker}
        </FilterChip>
      ))}
    </div>
  );
}

/** Same grid as DayView (chart 8/12 + legend 4/12) so nothing jumps when the day arrives. */
function DayViewSkeleton({ label }: { label: string }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12" aria-busy="true" aria-label={label}>
      <div className="glass-panel flex flex-col gap-3 rounded-2xl p-[var(--panel-p)] lg:col-span-8">
        <Skeleton className="h-4 w-2/3 rounded-md" />
        <Skeleton className="h-[340px] rounded-xl sm:h-[460px]" />
        <Skeleton className="h-4 w-1/2 rounded-md" />
      </div>
      <div className="glass-panel flex flex-col gap-2 rounded-2xl p-3 lg:col-span-4">
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
      </div>
    </div>
  );
}

export default function DeskDayPage() {
  const { t } = deskDayI18n.useT();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const member = !!user && user.role !== "guest";
  const { ticker, date, alias } = React.useMemo(() => readParams(search), [search]);
  const q = useDeskDay(ticker, date, member);
  const go = React.useCallback((tk: string, d: string) => setLocation(links.deskDay(tk, d)), [setLocation]);
  const top = useDeskDayTop(date || nyDate(), member);
  // No ticker in the address: open the desk's most traded ticker of its last trading day (replace: Back leaves the page).
  const first = !ticker && top.data?.date ? top.data.items[0] : undefined;
  React.useEffect(() => {
    if (first && top.data?.date) setLocation(links.deskDay(first.ticker, top.data.date), { replace: true });
  }, [first, top.data?.date, setLocation]);

  const header = (
    <PageHeader
      title={t("title")}
      icon={Users}
      description={ticker && date ? t("descFor", { ticker, date: fmtDate(date, "long") }) : t("desc")}
      actions={<><PickForm ticker={ticker} date={date} onGo={go} /><PlaybookSheetButton /></>}
    />
  );

  let body: React.ReactNode;
  if (!member) body = <Panel><EmptyState icon={Lock} title={t("guest.title")} description={t("guest.desc")} /></Panel>;
  else if ((!ticker || !date) && (top.isLoading || first)) body = <DayViewSkeleton label={t("loading")} />;
  else if (!ticker || !date) body = <Panel><EmptyState icon={Search} title={t("title")} description={t("form.hint")} /></Panel>;
  else if (q.isError) body = <Panel><QueryError error={q.error} onRetry={() => q.refetch()} /></Panel>;
  else if (!q.data) body = <DayViewSkeleton label={t("loading")} />;
  else if (!q.data.traders.length) body = <Panel><EmptyState icon={Users} title={t("empty.title", { ticker })} description={t("empty.desc")} /></Panel>;
  else body = <DayView day={q.data} ticker={ticker} date={date} alias={alias} />;

  return (
    <Page>
      {header}
      {member && top.data && <TopTickers top={top.data} ticker={ticker} date={date} onGo={go} />}
      {body}
    </Page>
  );
}
