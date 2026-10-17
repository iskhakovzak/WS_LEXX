import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LimitBar, Segmented, StatusDot, limitTone, limitToneToTone, toneOf, toneText, type Tone } from "@/components/ds";
import { KPI_FORMULAS } from "@/lib/trade-math";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { PHASE_LABEL, formatCountdown, getSessionState, type SessionPhase } from "./market-session";
import { fmtMoney, fmtR, plural, shortDate } from "./fmt";
import type { DashboardToday, RiskDesk, RiskMe, Scope } from "./use-dashboard";

function greeting(d: Date) {
  const h = d.getHours();
  if (h < 5) return "Доброй ночи";
  if (h < 12) return "Доброе утро";
  if (h < 18) return "Добрый день";
  return "Добрый вечер";
}

const PHASE_TONE: Record<SessionPhase, Tone> = { pre: "warn", regular: "up", after: "purple", closed: "neutral" };

/** One cell of the header state line: label · value · hint. */
function Cell({
  label,
  value,
  hint,
  tone = "neutral",
  loading,
  title,
  href,
  extra,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  loading?: boolean;
  title?: string;
  href?: string;
  extra?: ReactNode;
}) {
  const body = (
    <>
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      {loading ? (
        <Skeleton className="my-0.5 h-6 w-24 rounded-md" />
      ) : (
        <span className={cn("truncate text-xl font-semibold leading-7 tabular-nums tracking-tight", toneText(tone))}>{value}</span>
      )}
      {loading ? <Skeleton className="h-3.5 w-28 rounded" /> : hint != null && <span className="truncate text-xs text-muted-foreground tabular-nums">{hint}</span>}
      {!loading && extra}
    </>
  );
  const cls = "flex min-w-0 flex-col gap-0.5 lg:border-l lg:border-[var(--glass-border)] lg:pl-4";
  // Narrow cells truncate the hint: keep the full text reachable on hover.
  const tip = title ?? (typeof hint === "string" ? hint : undefined);
  if (href) {
    return (
      <Link
        href={href}
        title={tip}
        className={cn(cls, "rounded-lg transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
      >
        {body}
      </Link>
    );
  }
  return (
    <div className={cls} title={tip}>
      {body}
    </div>
  );
}

/** NY clock + phase + countdown. Ticks itself only, so the rest of the header does not re-render every second. */
function MarketCell({ holidays }: { holidays: { date: string; name: string }[] }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const s = getSessionState(now, holidays);
  const reason = s.phase === "closed" ? (s.holiday ?? (s.weekend ? "выходной" : null)) : null;
  return (
    <Cell
      label={
        <StatusDot tone={PHASE_TONE[s.phase]} pulse={s.phase === "regular"} className="text-xs text-muted-foreground">
          {PHASE_LABEL[s.phase]}
          {reason ? ` · ${reason}` : ""}
        </StatusDot>
      }
      title="Время Нью-Йорка (ET)"
      value={
        <>
          <time dateTime={`${s.nyDate}T${s.nyTime}`}>{s.nyTime.slice(0, 5)}</time>
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">NY</span>
        </>
      }
      hint={`${s.nextLabel} ${formatCountdown(s.msToNext)}`}
    />
  );
}

function RiskCell({ risk, desk, team, loading }: { risk: RiskMe | null | undefined; desk: RiskDesk | null | undefined; team: boolean; loading: boolean }) {
  if (team) {
    if (desk === undefined && loading) return <Cell label="Риск-лимиты деска" value="" loading />;
    if (!desk) return <Cell label="Риск-лимиты деска" value="—" hint="Риск-деск недоступен" href={links.risk()} />;
    const s = desk.summary;
    const bad = s.halted + s.breach;
    const value = bad > 0 ? `${bad} ${plural(bad, ["стоп", "стопа", "стопов"])}` : s.warn > 0 ? `${s.warn} близко к лимиту` : "Все в лимитах";
    const tone: Tone = bad > 0 ? "down" : s.warn > 0 ? "warn" : "up";
    return (
      <Cell
        label="Риск-лимиты деска"
        value={value}
        tone={tone}
        hint={s.noLimits > 0 ? `${s.noLimits} ${plural(s.noLimits, ["трейдер", "трейдера", "трейдеров"])} без лимитов` : `${s.traders} ${plural(s.traders, ["трейдер", "трейдера", "трейдеров"])}`}
        href={links.risk()}
      />
    );
  }
  if (risk === undefined && loading) return <Cell label="Дневной лимит" value="" loading />;
  if (!risk) return <Cell label="Дневной лимит" value="—" hint="Риск-деск недоступен" />;
  if (risk.halted) {
    return <Cell label="Дневной лимит" value={risk.stop.label} tone="down" hint={risk.stop.message} href={links.risk(risk.trader)} title={risk.stop.message} />;
  }
  const limit = risk.limits?.dailyLossLimit ?? null;
  if (!risk.limits || limit == null || limit <= 0) {
    return <Cell label="Дневной лимит" value="Не задан" hint="Лимиты задаёт куратор" href={links.risk(risk.trader)} />;
  }
  const loss = Math.max(0, -(risk.today.pnlNet ?? 0));
  const remaining = risk.today.dailyRemainingUsd ?? Math.max(0, limit - loss);
  const lt = limitTone(loss, limit, 0.6);
  return (
    <Cell
      label="Остаток дневного лимита"
      value={`$${Math.round(remaining).toLocaleString("ru-RU")}`}
      tone={lt === "ok" ? "neutral" : limitToneToTone(lt)}
      hint={`из $${Math.round(limit).toLocaleString("ru-RU")} · использовано ${Math.round(Math.min(1, loss / limit) * 100)}%`}
      href={links.risk(risk.trader)}
      extra={<LimitBar used={loss} limit={limit} warnAt={0.6} size="sm" showValues={false} className="mt-1" />}
    />
  );
}

/**
 * Dashboard header: who / when, and one line of state — NY session, today and week net P&L, risk limit.
 * No entry CTAs: trades arrive automatically; manual writing lives in the playbook, plans and the journal.
 */
export function DashboardHeader({
  data,
  risk,
  desk,
  isLoading,
  isError,
  onRetry,
  guest,
  scope,
  onScopeChange,
  canChooseScope,
  userName,
  customize,
}: {
  data: DashboardToday | undefined;
  risk: RiskMe | null | undefined;
  desk: RiskDesk | null | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  guest: boolean;
  scope: Scope;
  onScopeChange: (s: Scope) => void;
  canChooseScope: boolean;
  userName: string | null;
  customize: ReactNode;
}) {
  const now = new Date();
  const rawDate = now.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  // «Суббота, 17 октября»: only the first letter is capital (CSS `capitalize` would also give «Октября»).
  const dateLabel = rawDate.charAt(0).toUpperCase() + rawDate.slice(1);
  const t = data?.today;
  const w = data?.week;
  const loading = isLoading && !data;
  const team = scope === "team";
  const quietDay = !!data && (data.market.weekend || !!data.market.holidayToday);

  const todayValue = t?.pnlNet != null ? fmtMoney(t.pnlNet) : t && t.rCount > 0 ? fmtR(t.r) : "—";
  const todayHint = t
    ? t.closed > 0
      ? `${t.closed} ${plural(t.closed, ["сделка", "сделки", "сделок"])} · ${t.wins}W / ${t.losses}L${t.pnlNet != null && t.rCount > 0 ? ` · ${fmtR(t.r)}` : ""}${t.fees ? ` · комиссии ${fmtMoney(-Math.abs(t.fees))}` : ""}`
      : quietDay
        ? "Рынок закрыт"
        : "Закрытых сделок пока нет"
    : undefined;

  const weekValue = w?.pnlNet != null ? fmtMoney(w.pnlNet) : w && w.rCount > 0 ? fmtR(w.r) : "—";
  const weekHint = w
    ? w.closed > 0
      ? `${w.closed} ${plural(w.closed, ["сделка", "сделки", "сделок"])} · ${w.greenDays}/${w.tradingDays} дн. в плюсе`
      : "Сделок на неделе нет"
    : undefined;

  return (
    <section aria-labelledby="dash-hero-title" className="glass-panel rounded-2xl p-[var(--panel-p)]">
      <div className="grid items-center gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-[minmax(270px,1.35fr)_repeat(4,minmax(0,1fr))]">
        <div className="flex min-w-0 items-start justify-between gap-2 sm:col-span-2 lg:col-span-1">
          <div className="min-w-0">
            <p className="truncate text-xs text-muted-foreground">
              {dateLabel}
              {data && data.market.nyDate !== data.date ? ` · торговый день ${shortDate(data.date)}` : ""}
            </p>
            <h1 id="dash-hero-title" className="line-clamp-2 text-xl font-semibold leading-7 tracking-tight [overflow-wrap:anywhere]">
              {greeting(now)}
              {userName ? `, ${userName}` : ""}
            </h1>
            {canChooseScope && !guest && (
              <Segmented<Scope>
                ariaLabel="Чьи данные показывать"
                size="sm"
                className="mt-1.5"
                value={scope}
                onChange={onScopeChange}
                options={[
                  { value: "me", label: "Мои" },
                  { value: "team", label: "Команда" },
                ]}
              />
            )}
          </div>
          <div className="shrink-0">{customize}</div>
        </div>

        <MarketCell holidays={data?.market.holidays ?? []} />

        {guest ? (
          <div className="flex min-w-0 flex-col gap-0.5 sm:col-span-2 lg:col-span-3 lg:border-l lg:border-[var(--glass-border)] lg:pl-4">
            <span className="text-sm font-medium">Гостевой режим</span>
            <span className="text-xs text-muted-foreground">Войдите под своим именем, чтобы видеть P&L, задачи и кривую капитала.</span>
          </div>
        ) : isError && !data ? (
          <div className="flex min-w-0 items-center gap-3 sm:col-span-2 lg:col-span-3 lg:border-l lg:border-[var(--glass-border)] lg:pl-4">
            <span className="text-sm">Не удалось загрузить сводку дня</span>
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw aria-hidden="true" />
              Повторить
            </Button>
          </div>
        ) : (
          <>
            <Cell
              label={team ? "Деск сегодня · нетто" : "Сегодня · нетто"}
              title={KPI_FORMULAS.netPnl}
              loading={loading}
              value={todayValue}
              tone={toneOf(t?.pnlNet ?? (t && t.rCount > 0 ? t.r : null))}
              hint={todayHint}
            />
            <Cell
              label={w ? `Неделя с ${shortDate(w.from)} · нетто` : "Неделя · нетто"}
              title="Понедельник–пятница по Нью-Йорку, по дате закрытия сделки"
              loading={loading}
              value={weekValue}
              tone={toneOf(w?.pnlNet ?? (w && w.rCount > 0 ? w.r : null))}
              hint={weekHint}
            />
            <RiskCell risk={risk} desk={desk} team={team} loading={loading} />
          </>
        )}
      </div>
    </section>
  );
}
