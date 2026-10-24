import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LimitBar, LiveNumber, Segmented, StatusDot, limitTone, limitToneToTone, toneOf, toneText, type Tone } from "@/components/ds";
import { KPI_FORMULAS } from "@/lib/trade-math";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { PHASE_LABEL, formatCountdown, getSessionState, type SessionPhase } from "./market-session";
import { shortDate } from "./fmt";
import { DESK_TZ, fmtDate, fmtR, fmtRate, fmtTimeNY, fmtUsd } from "@/lib/format";
import type { DashboardToday, RiskDesk, RiskMe, Scope } from "./use-dashboard";
import { LiveBadge } from "@/components/shared/live-badge";
import { AskCuratorButton } from "@/components/shared/ask-curator";
import { commonI18n } from "@/i18n/ns/common";
import { dashboardI18n } from "@/i18n/ns/dashboard";
import { personName } from "@/i18n";

/** Greeting by the desk clock (New York) — the same «16:02 NY» the hero shows, not the browser's zone. */
export function greeting(d: Date) {
  const h = Number(fmtTimeNY(d).slice(0, 2)) || 0;
  const t = dashboardI18n.t;
  if (h < 5) return t("hero.greeting.night");
  if (h < 12) return t("hero.greeting.morning");
  if (h < 18) return t("hero.greeting.day");
  return t("hero.greeting.evening");
}

/**
 * Traders on a stop or in breach today, each counted once (a halted trader is also in breach). The server sends the
 * distinct count as `stopped`; an older server only has the two overlapping counts — the larger one is the best guess.
 */
export function stoppedTraders(s: { halted: number; breach: number; stopped?: unknown }): number {
  return typeof s.stopped === "number" ? s.stopped : Math.max(s.halted, s.breach);
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
      {loading ? <Skeleton className="h-3.5 w-28 rounded" /> : hint != null && <span className="text-xs text-muted-foreground tabular-nums max-lg:line-clamp-2 lg:truncate">{hint}</span>}
      {!loading && extra}
    </>
  );
  const cls = "flex min-w-0 flex-col gap-0.5";
  // Narrow desktop cells truncate the hint: keep the full text reachable on hover. Phones (no hover, one cell per
  // row) wrap it to two lines instead («Max drawdown reached: $947.66 from peak with a …» was cut).
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

/**
 * The day's number (owner, 2026-10-24: «huge confident numbers»): today's net P&L at hero size, counting up from 0 and
 * resolving blur-to-sharp when it first appears (instant under reduced motion). Colour only says up / down.
 */
function HeroCell({
  label,
  value,
  format,
  resetKey,
  hint,
  tone,
  loading,
  title,
}: {
  label: ReactNode;
  value: number | null;
  format: (n: number) => string;
  /** Scope / unit of the number: a switch re-bases it without a live flash. */
  resetKey: string;
  hint?: ReactNode;
  tone: Tone;
  loading?: boolean;
  title?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1" title={title}>
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      {loading ? (
        <Skeleton className="h-10 w-40 max-w-full rounded-xl" />
      ) : value == null ? (
        <span className="type-hero text-muted-foreground/70 max-sm:text-[1.75rem]">—</span>
      ) : (
        // The reveal sits on a wrapper: the live flash is an animation too, and on the same element it would replace
        // (and on removal restart) the reveal. Phones (2 × 2 cells) take a smaller step of the same scale.
        <span className={cn("reveal type-hero w-fit max-w-full whitespace-nowrap max-sm:text-[1.625rem]", toneText(tone))}>
          <LiveNumber value={value} format={format} resetKey={resetKey} countIn countInDuration={700} />
        </span>
      )}
      {loading ? <Skeleton className="h-3.5 w-40 rounded" /> : hint != null && <span className="truncate text-xs text-muted-foreground tabular-nums">{hint}</span>}
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
  const reason = s.phase === "closed" ? (s.holiday ?? (s.weekend ? dashboardI18n.t("hero.weekend") : null)) : null;
  return (
    <Cell
      label={
        <StatusDot tone={PHASE_TONE[s.phase]} pulse={s.phase === "regular"} className="text-xs text-muted-foreground">
          {PHASE_LABEL[s.phase]}
          {reason ? ` · ${reason}` : ""}
        </StatusDot>
      }
      title={dashboardI18n.t("hero.nyTime")}
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

/**
 * The daily stop as a meter. A halt is red only on a trading day (trading is really stopped today); on a weekend /
 * market holiday the same status reads neutrally («рынок закрыт»), never as a Saturday alarm.
 */
function RiskCell({ risk, desk, team, loading, quietDay }: { risk: RiskMe | null | undefined; desk: RiskDesk | null | undefined; team: boolean; loading: boolean; quietDay: boolean }) {
  const { t } = dashboardI18n.useT();
  if (team) {
    if (desk === undefined && loading) return <Cell label={t("hero.deskLimits")} value="" loading />;
    if (!desk) return <Cell label={t("hero.deskLimits")} value="—" hint={t("hero.riskUnavailable")} href={links.risk()} />;
    const s = desk.summary;
    const bad = stoppedTraders(s);
    const value = bad > 0 ? t("hero.stops", { count: bad }) : s.warn > 0 ? t("hero.nearLimit", { count: s.warn }) : t("hero.allWithin");
    const tone: Tone = bad > 0 ? "down" : s.warn > 0 ? "warn" : "up";
    return (
      <Cell
        label={t("hero.deskLimits")}
        value={value}
        tone={tone}
        hint={s.noLimits > 0 ? t("hero.noLimits", { traders: commonI18n.t("units.traders", { count: s.noLimits }) }) : commonI18n.t("units.traders", { count: s.traders })}
        href={links.risk()}
      />
    );
  }
  if (risk === undefined && loading) return <Cell label={t("hero.dailyLimit")} value="" loading />;
  if (!risk) return <Cell label={t("hero.dailyLimit")} value="—" hint={t("hero.riskUnavailable")} />;
  if (risk.halted && quietDay) {
    return (
      <Cell
        label={t("hero.dailyLimit")}
        value={risk.stop.label}
        hint={t("hero.haltedClosed")}
        href={links.risk(risk.trader)}
        title={risk.stop.message}
      />
    );
  }
  if (risk.halted) {
    return <Cell label={t("hero.dailyLimit")} value={risk.stop.label} tone="down" hint={risk.stop.message} href={links.risk(risk.trader)} title={risk.stop.message} extra={<LiveBadge live={risk.live} />} />;
  }
  const limit = risk.limits?.dailyLossLimit ?? null;
  if (!risk.limits || limit == null || limit <= 0) {
    // No dead end (Волна 1 п. 1.1): the trader asks the curator right here (a button cannot sit inside the cell link).
    return <Cell label={t("hero.dailyLimit")} value={t("hero.notSet")} hint={t("hero.setByCurator")} extra={<AskCuratorButton kind="limits" size="xs" className="mt-1 self-start" />} />;
  }
  const bp = risk.limits.buyingPower ?? null;
  const loss = Math.max(0, -(risk.today.pnlNet ?? 0));
  const remaining = risk.today.dailyRemainingUsd ?? Math.max(0, limit - loss);
  const lt = limitTone(loss, limit, 0.6);
  return (
    <Cell
      label={t("hero.remaining")}
      value={<LiveNumber value={remaining} format={(n) => fmtUsd(n, { decimals: 0 })} announce />}
      tone={lt === "ok" ? "neutral" : limitToneToTone(lt)}
      hint={t("hero.usedOf", { limit: fmtUsd(limit, { decimals: 0 }), pct: fmtRate(Math.min(1, loss / limit)) })}
      href={links.risk(risk.trader)}
      extra={<>
        <LimitBar used={loss} limit={limit} warnAt={0.6} size="sm" showValues={false} className="mt-1" />
        {bp != null && <span className="truncate text-2xs tabular-nums text-muted-foreground">{t("hero.buyingPower", { amount: fmtUsd(bp, { decimals: 0 }) })}</span>}
        <LiveBadge live={risk.live} className="mt-0.5" />
      </>}
    />
  );
}

/**
 * «Сегодня» — the hero strip, read in two seconds: greeting + date on the left, «Мои / Команда» on the right, then four
 * equal cells: today's net (the screen's one hero number), the week's net, what is left to the daily stop (a meter) and
 * the NY market clock. Nothing else lives here: the day's to-do is «План на день», progress sits in its footer.
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
}) {
  const { t: tr } = dashboardI18n.useT();
  const now = new Date();
  const rawDate = fmtDate(now, "weekdayDayMonthLong", { timeZone: DESK_TZ });
  // «Суббота, 17 октября»: only the first letter is capital (CSS `capitalize` would also give «Октября»).
  const dateLabel = rawDate.charAt(0).toUpperCase() + rawDate.slice(1);
  const t = data?.today;
  const w = data?.week;
  const loading = isLoading && !data;
  const team = scope === "team";
  const quietDay = !!data && (data.market.weekend || !!data.market.holidayToday);
  // Live-number context from the answer itself: right after a scope switch the previous scope's numbers are still shown
  // (keepPreviousData), so the toggle alone would flash the arrival of the other scope's total.
  const liveKey = data ? `${data.scope}:${data.trader ?? ""}:${data.date}` : "";

  // The hero number: net dollars, else R when only R is known, else nothing yet.
  const todayNum = t?.pnlNet != null ? t.pnlNet : t && t.rCount > 0 ? t.r : null;
  const todayFormat = t?.pnlNet != null ? (n: number) => fmtUsd(n, { signed: true }) : fmtR;
  const todayHint = t
    ? t.closed > 0
      ? [
          commonI18n.t("units.trades", { count: t.closed }),
          `${t.wins}W / ${t.losses}L`,
          t.pnlNet != null && t.rCount > 0 ? fmtR(t.r) : null,
          t.fees ? tr("hero.fees", { amount: fmtUsd(-Math.abs(t.fees), { signed: true }) }) : null,
        ].filter(Boolean).join(" · ")
      : quietDay
        ? tr("hero.marketClosed")
        : tr("hero.noClosed")
    : undefined;

  const weekValue = w?.pnlNet != null
    ? <LiveNumber value={w.pnlNet} format={(n) => fmtUsd(n, { signed: true })} resetKey={liveKey} />
    : w && w.rCount > 0 ? fmtR(w.r) : "—";
  const weekHint = w
    ? w.closed > 0
      ? tr("hero.weekHint", { trades: commonI18n.t("units.trades", { count: w.closed }), green: w.greenDays, days: w.tradingDays })
      : tr("hero.noWeekTrades")
    : undefined;

  const wide = "col-span-2 lg:col-span-3";
  return (
    <section aria-labelledby="dash-hero-title" className="ins-tile glass-panel dash-card gap-5!">
      {/* Greeting: display type, the name in the intro's italic serif (the screen's one accent word). */}
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">
            {dateLabel}
            {data && data.market.nyDate !== data.date ? ` · ${tr("hero.tradingDay", { date: shortDate(data.date) })}` : ""}
          </p>
          <h1 id="dash-hero-title" className="reveal mt-1 line-clamp-2 type-display text-foreground [overflow-wrap:anywhere]">
            {greeting(now)}
            {userName ? <>, <em className="type-accent">{personName(userName)}</em></> : ""}
          </h1>
        </div>
        {canChooseScope && !guest && (
          <Segmented<Scope>
            ariaLabel={tr("hero.scopeAria")}
            size="sm"
            value={scope}
            onChange={onScopeChange}
            options={[
              { value: "me", label: tr("hero.mine") },
              { value: "team", label: tr("hero.team") },
            ]}
          />
        )}
      </div>

      <div className="dash-kpis">
        {guest ? (
          <>
            <MarketCell holidays={data?.market.holidays ?? []} />
            <div className={cn("flex min-w-0 flex-col gap-0.5", wide)}>
              <span className="text-sm font-medium">{tr("hero.guest")}</span>
              <span className="text-xs text-muted-foreground">{tr("hero.guestHint")}</span>
            </div>
          </>
        ) : isError && !data ? (
          <>
            <MarketCell holidays={[]} />
            <div className={cn("flex min-w-0 flex-wrap items-center gap-3", wide)}>
              <span className="text-sm">{tr("hero.loadFailed")}</span>
              <Button variant="outline" size="sm" onClick={onRetry}>
                <RefreshCw aria-hidden="true" />
                {commonI18n.t("actions.retry")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <HeroCell
              label={team ? tr("hero.deskToday") : tr("hero.today")}
              title={KPI_FORMULAS.netPnl}
              loading={loading}
              value={todayNum}
              format={todayFormat}
              resetKey={`${liveKey}:${t?.pnlNet != null ? "usd" : "r"}`}
              tone={toneOf(todayNum)}
              hint={todayHint}
            />
            <Cell
              label={w ? tr("hero.weekFrom", { date: shortDate(w.from) }) : tr("hero.week")}
              title={tr("hero.weekTitle")}
              loading={loading}
              value={weekValue}
              tone={toneOf(w?.pnlNet ?? (w && w.rCount > 0 ? w.r : null))}
              hint={weekHint}
            />
            <div data-tour="risk" className="min-w-0"><RiskCell risk={risk} desk={desk} team={team} loading={loading} quietDay={quietDay} /></div>
            <MarketCell holidays={data?.market.holidays ?? []} />
          </>
        )}
      </div>
    </section>
  );
}
