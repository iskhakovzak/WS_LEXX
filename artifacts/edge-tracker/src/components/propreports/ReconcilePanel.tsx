/**
 * «Сверка с брокером» — journal vs PropReports, from GET /api/reconcile (engine: api-server lib/reconcile.ts).
 *
 * Self-contained: <ReconcilePanel /> (curators pick a trader; traders always see their own book),
 * <ReconcilePanel trader="Ориф" />, <ReconcilePanel trader="Ориф" compact /> for /stats next to PerformanceReportPanel.
 */
import * as React from "react";
import { Link } from "wouter";
import { ChevronDown, ChevronRight, Download, RefreshCw, Scale } from "lucide-react";
import { DataTable, EmptyState, Panel, Pill, StatCard, StatGrid, type Tone } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-context";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import {
  FEE_ROUNDING_LABEL, ReconcileHttpError, discrepanciesCsv, downloadText, useReconcile,
  type Compare, type CompareStatus, type DayRow, type Issue, type ReportCheck, type Severity,
} from "./reconcile-api";

const ALL = "__all__";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
function money(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = usd.format(Math.abs(v));
  return v < 0 ? `−${s}` : s;
}
function signed(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) < 0.005) return "$0.00";
  return `${v > 0 ? "+" : ""}${money(v)}`;
}
const toneOfMoney = (v: number | null | undefined): Tone => (v == null || Math.abs(v) < 0.005 ? "neutral" : v > 0 ? "up" : "down");

const STATUS_META: Record<Severity, { icon: string; label: string; tone: Tone; text: string }> = {
  ok: { icon: "✓", label: "сходится", tone: "up", text: "text-up" },
  warn: { icon: "⚠", label: "расхождение < $1", tone: "warn", text: "text-[hsl(var(--chart-3))]" },
  error: { icon: "✗", label: "серьёзное расхождение", tone: "down", text: "text-down" },
};

function StatusMark({ status, className }: { status: CompareStatus; className?: string }) {
  if (status === "na") return <span className={cn("text-muted-foreground", className)} aria-label="нет данных для сравнения">—</span>;
  const m = STATUS_META[status];
  return (
    <span className={cn("font-semibold", m.text, className)} role="img" aria-label={m.label} title={m.label}>
      {m.icon}
    </span>
  );
}

function issueHref(i: Issue): string | null {
  if (i.tradeIds.length === 1) return links.trade(i.tradeIds[0]);
  if (i.tradeIds.length > 1) return links.trades({ ids: i.tradeIds });
  if (i.ticker) return links.trades({ ticker: i.ticker });
  if (i.date) return links.trades({ date: i.date });
  return null;
}

function IssueItem({ issue, trader }: { issue: Issue; trader: string | null }) {
  const href = issueHref(issue);
  return (
    <li className="flex items-start gap-2 rounded-xl border border-border/50 px-3 py-2 text-sm">
      <StatusMark status={issue.severity} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="text-foreground">{issue.message}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {issue.cause === "fee_rounding" && <Pill tone="accent" title={issue.hint}>{FEE_ROUNDING_LABEL}</Pill>}
          {issue.diff != null && <span className="tabular-nums">разница {signed(issue.diff)}</span>}
          {href && (
            <Link href={href} className="text-primary underline-offset-2 hover:underline">
              {issue.tradeIds.length === 1 ? `сделка #${issue.tradeIds[0]}` : issue.tradeIds.length > 1 ? `сделки (${issue.tradeIds.length})` : issue.ticker ? `сделки ${issue.ticker}` : "сделки дня"}
            </Link>
          )}
          {issue.date && (
            <Link href={links.journalDay(issue.date, issue.trader ?? trader ?? undefined)} className="text-primary underline-offset-2 hover:underline">
              журнал {issue.date}
            </Link>
          )}
        </div>
        {issue.hint && issue.cause !== "fee_rounding" && <div className="mt-1 text-xs text-muted-foreground">{issue.hint}</div>}
      </div>
    </li>
  );
}

function CompareTable({ rows, caption }: { rows: Compare[]; caption: string }) {
  if (!rows.length) return null;
  const isCount = (k: string) => k === "trades" || k === "wins" || k === "losses";
  return (
    <DataTable ariaLabel={caption}>
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr><th scope="col">Показатель</th><th scope="col" className="text-right">Журнал</th><th scope="col" className="text-right">Брокер</th><th scope="col" className="text-right">Разница</th><th scope="col">Статус</th></tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.key}>
              <td>{c.label}</td>
              <td className="text-right">{isCount(c.key) ? c.journal ?? "—" : money(c.journal)}</td>
              <td className="text-right">{isCount(c.key) ? c.broker ?? "—" : money(c.broker)}</td>
              <td className="text-right">{c.diff == null ? "—" : isCount(c.key) ? (c.diff > 0 ? `+${c.diff}` : c.diff) : signed(c.diff)}</td>
              <td>
                <span className="inline-flex items-center gap-2">
                  <StatusMark status={c.status} />
                  {c.cause === "fee_rounding" ? <Pill tone="accent">{FEE_ROUNDING_LABEL}</Pill> : c.note ? <span className="text-xs text-muted-foreground">{c.note}</span> : null}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataTable>
  );
}

function ReportBlock({ rep }: { rep: ReportCheck }) {
  const badGroups = rep.groups.filter((g) => g.status !== "ok");
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusMark status={rep.status} />
        <span className="font-medium">Отчёт Trade Performance</span>
        <span className="text-muted-foreground">счёт {rep.account ?? "—"} · {rep.periodFrom} — {rep.periodTo}</span>
      </div>
      <CompareTable rows={rep.compares} caption="Итоги журнала против отчёта брокера" />
      {rep.feeTypes.length > 0 && (
        <details className="rounded-xl border border-border/50 px-3 py-2">
          <summary className="cursor-pointer text-sm">Комиссии по типам ({rep.feeTypes.filter((c) => c.status !== "ok").length} расх.)</summary>
          <p className="mt-1 text-xs text-muted-foreground">Брокер: средняя комиссия на сделку × число сделок (оценка).</p>
          <div className="mt-2"><CompareTable rows={rep.feeTypes} caption="Комиссии по типам" /></div>
        </details>
      )}
      <div className="text-xs text-muted-foreground">
        Проверено групп (сторона / день недели / символ): {rep.groups.length}, расходится: {badGroups.length}
        {rep.symbolsMissingInJournal.length > 0 && <> · нет в журнале: {rep.symbolsMissingInJournal.join(", ")}</>}
        {rep.symbolsMissingInReport.length > 0 && <> · нет у брокера: {rep.symbolsMissingInReport.join(", ")}</>}
        {rep.manualInPeriod.trades > 0 && <> · ручных сделок в периоде: {rep.manualInPeriod.trades} ({signed(rep.manualInPeriod.net)})</>}
      </div>
    </div>
  );
}

function DayDetails({ day, issues, trader }: { day: DayRow; issues: Issue[]; trader: string | null }) {
  return (
    <div className="grid gap-3 py-2">
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>Источник брокера: {day.brokerSource === "report-days" ? "дневные итоги отчёта" : day.brokerSource === "snapshot" ? "снимок PropReports в сделках" : "нет"}</span>
        <span>С исполнениями: {day.fills.withFills} · без: {day.fills.withoutFills}</span>
        {day.manual.trades > 0 && <span>Ручные: {day.manual.trades} сд., нетто {signed(day.manual.net)} (не входят в сверку с брокером)</span>}
        <Link href={links.trades({ date: day.date })} className="text-primary hover:underline">Сделки дня</Link>
        <Link href={links.journalDay(day.date, trader ?? undefined)} className="text-primary hover:underline">Журнал дня</Link>
      </div>
      {day.compares.length > 0 && <CompareTable rows={day.compares} caption={`Сверка за ${day.date}`} />}
      {issues.length > 0 ? (
        <ul className="grid gap-2">{issues.map((i) => <IssueItem key={i.id} issue={i} trader={trader} />)}</ul>
      ) : (
        <p className="text-xs text-muted-foreground">Расхождений за день нет.</p>
      )}
    </div>
  );
}

export function ReconcilePanel({ trader: traderProp, compact = false }: { trader?: string; compact?: boolean }) {
  const { isCurator, isAdmin, dbUsers, user } = useAuth();
  const staff = isCurator || isAdmin;
  const [picked, setPicked] = React.useState<string>(traderProp ?? (staff ? ALL : user?.traderName ?? ""));
  React.useEffect(() => { if (traderProp) setPicked(traderProp); }, [traderProp]);
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [onlyBad, setOnlyBad] = React.useState(true);
  const [open, setOpen] = React.useState<Set<string>>(() => new Set());
  const [issueFilter, setIssueFilter] = React.useState<"all" | "error" | "warn">("all");

  const trader = traderProp ?? (staff ? (picked === ALL ? null : picked) : null);
  const q = useReconcile({ trader, from: from || null, to: to || null });
  const data = q.data;

  const issueById = React.useMemo(() => new Map((data?.issues ?? []).map((i) => [i.id, i])), [data]);
  const traders = React.useMemo(() => dbUsers.filter((u) => u.active && u.role !== "guest").map((u) => u.name).sort((a, b) => a.localeCompare(b, "ru")), [dbUsers]);
  const scopeName = data?.scope ?? trader;

  const exportCsv = () => {
    if (!data) return;
    downloadText(`сверка-${scopeName ?? "деск"}-${from || "все"}-${to || "все"}.csv`.replace(/[\\/:*?"<>|\s]+/g, "_"), discrepanciesCsv(data.issues));
  };

  const toggle = (date: string) => setOpen((s) => { const n = new Set(s); if (n.has(date)) n.delete(date); else n.add(date); return n; });

  const s = data?.summary;
  const rep = data?.reports[0] ?? null;
  const repNet = rep?.compares.find((c) => c.key === "net") ?? null;
  const statusTone: Tone = !s ? "neutral" : s.discrepancies === 0 ? "up" : s.status === "error" ? "down" : "warn";

  const pill = s ? (
    <Pill tone={statusTone} dot title={s.discrepancies ? `✗ ${s.counts.error} · ⚠ ${s.counts.warn}` : undefined}>
      {s.discrepancies === 0 ? "Данные сходятся с брокером" : s.label}
    </Pill>
  ) : null;

  const actions = (
    <>
      {pill}
      {!compact && (
        <>
          <Button type="button" variant="outline" size="sm" onClick={exportCsv} disabled={!data || !s?.discrepancies} aria-label="Скачать расхождения в CSV">
            <Download className="mr-1 h-4 w-4" aria-hidden="true" /> CSV
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={() => q.refetch()} disabled={q.isFetching} aria-label="Пересчитать сверку">
            <RefreshCw className={cn("h-4 w-4", q.isFetching && "animate-spin")} aria-hidden="true" />
          </Button>
        </>
      )}
    </>
  );

  const days = (data?.days ?? []).filter((d) => !onlyBad || d.status !== "ok");
  const issues = (data?.issues ?? []).filter((i) => i.severity !== "ok" && (issueFilter === "all" || i.severity === issueFilter));

  return (
    <Panel
      title="Сверка с брокером"
      description={compact ? undefined : "Журнал против PropReports: по дням, итогам отчёта, комиссиям, исполнениям и дублям. ✓ ≤ $0.01 · ⚠ < $1 · ✗ серьёзное"}
      icon={Scale}
      actions={actions}
      aria-busy={q.isFetching}
    >
      {!compact && (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          {staff && !traderProp && (
            <div className="grid gap-1">
              <label className="text-xs text-muted-foreground" id="rc-trader-label">Трейдер</label>
              <Select value={picked} onValueChange={setPicked}>
                <SelectTrigger className="h-9 w-48" aria-labelledby="rc-trader-label"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Весь деск</SelectItem>
                  {traders.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-1">
            <label htmlFor="rc-from" className="text-xs text-muted-foreground">С (NY дата закрытия)</label>
            <Input id="rc-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" />
          </div>
          <div className="grid gap-1">
            <label htmlFor="rc-to" className="text-xs text-muted-foreground">По</label>
            <Input id="rc-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" />
          </div>
          {(from || to) && <Button type="button" variant="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); }}>Весь период</Button>}
        </div>
      )}

      {q.isLoading ? (
        <div className="grid gap-3" aria-label="Загрузка сверки"><Skeleton className="h-20 w-full" /><Skeleton className="h-40 w-full" /></div>
      ) : q.isError ? (
        <EmptyState
          icon={Scale}
          title={q.error instanceof ReconcileHttpError && q.error.status === 404 ? "Сверка ещё не подключена на сервере" : "Не удалось выполнить сверку"}
          description={q.error instanceof Error ? q.error.message : String(q.error)}
          action={<Button type="button" variant="outline" size="sm" onClick={() => q.refetch()}>Повторить</Button>}
        />
      ) : !data || !s || s.tradesChecked === 0 ? (
        <EmptyState icon={Scale} title="Нет сделок для сверки" description="Импортируйте отчёт Trades или исполнения PropReports на странице интеграций — сверка появится автоматически." />
      ) : compact ? (
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div><div className="text-xs text-muted-foreground">Нетто журнала</div><div className={cn("font-semibold tabular-nums", toneOfMoney(s.journal.net) === "up" ? "text-up" : toneOfMoney(s.journal.net) === "down" ? "text-down" : "")}>{signed(s.journal.net)}</div></div>
            <div><div className="text-xs text-muted-foreground">Нетто брокера</div><div className="font-semibold tabular-nums">{repNet ? signed(repNet.broker) : "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Разница</div><div className="font-semibold tabular-nums">{repNet ? signed(repNet.diff) : "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Дней с расхождениями</div><div className="font-semibold tabular-nums">{s.daysWithIssues} / {s.days}</div></div>
          </div>
          {issues.length > 0 && <ul className="grid gap-2">{issues.slice(0, 4).map((i) => <IssueItem key={i.id} issue={i} trader={scopeName} />)}</ul>}
          {issues.length > 4 && <p className="text-xs text-muted-foreground">…и ещё {issues.length - 4}. Полная сверка — на странице интеграций.</p>}
        </div>
      ) : (
        <div className="grid gap-5">
          <StatGrid>
            <StatCard label="Нетто журнала (брокерские сделки)" value={signed(s.journal.net)} tone={toneOfMoney(s.journal.net)} hint={`брутто ${money(s.journal.gross)} · комиссии ${money(s.journal.fees)}`} />
            <StatCard label="Нетто по отчёту брокера" value={repNet ? signed(repNet.broker) : "—"} hint={rep ? `${rep.periodFrom} — ${rep.periodTo}` : "отчёт Trade Performance не загружен"} />
            <StatCard
              label="Разница с брокером"
              value={repNet ? signed(repNet.diff) : "—"}
              tone={!repNet || repNet.status === "ok" ? "neutral" : repNet.status === "error" ? "down" : "warn"}
              hint={repNet?.cause === "fee_rounding" ? FEE_ROUNDING_LABEL : repNet?.note}
            />
            <StatCard label="Проверено" value={`${s.tradesChecked} сд.`} hint={`${s.days} дн. · с fills ${s.fills.withFills} · без ${s.fills.withoutFills}${s.manual.trades ? ` · ручных ${s.manual.trades}` : ""}`} />
          </StatGrid>

          {s.roundingIssues > 0 && (
            <p className="rounded-xl border border-border/50 px-3 py-2 text-xs text-muted-foreground">
              <Pill tone="accent">{FEE_ROUNDING_LABEL}</Pill>{" "}
              {s.roundingIssues} из {s.discrepancies} расхождений укладываются в $0.01 × число сделок: при импорте PropReports комиссии округляются до центов по каждой сделке. После исправления импорта и повторного импорта они исчезнут.
            </p>
          )}

          {data.reports.length > 0 ? (
            data.reports.map((r) => <ReportBlock key={r.reportId} rep={r} />)
          ) : (
            <p className="text-xs text-muted-foreground">Отчёт Trade Performance не загружен — итоги сверяются только со снимками PropReports в сделках. Загрузите отчёт на /integrations.</p>
          )}

          <section aria-labelledby="rc-days-title" className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="rc-days-title" className="text-sm font-semibold">По дням <span className="font-normal text-muted-foreground">({s.daysWithIssues} из {s.days} с расхождениями)</span></h3>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={onlyBad} onChange={(e) => setOnlyBad(e.target.checked)} /> только с расхождениями
              </label>
            </div>
            {days.length === 0 ? (
              <p className="text-xs text-muted-foreground">{onlyBad ? "Все дни сходятся ✓" : "Нет дней в периоде."}</p>
            ) : (
              <DataTable maxHeight="60vh" ariaLabel="Сверка по дням">
                <table>
                  <thead>
                    <tr>
                      <th scope="col" className="w-8"><span className="sr-only">Раскрыть</span></th>
                      <th scope="col">Дата</th>
                      <th scope="col">Статус</th>
                      <th scope="col" className="text-right">Сделок</th>
                      <th scope="col" className="text-right">Брутто</th>
                      <th scope="col" className="text-right">Комиссии</th>
                      <th scope="col" className="text-right">Нетто журнала</th>
                      <th scope="col" className="text-right">Нетто брокера</th>
                      <th scope="col" className="text-right">Разница</th>
                      <th scope="col" className="text-right">Ручные</th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((d) => {
                      const isOpen = open.has(d.date);
                      const diff = d.broker ? d.journal.net - d.broker.net : null;
                      const dayIssues = d.issueIds.map((id) => issueById.get(id)).filter((x): x is Issue => !!x);
                      return (
                        <React.Fragment key={d.date}>
                          <tr className="cursor-pointer" onClick={() => toggle(d.date)}>
                            <td>
                              <button type="button" className="grid h-6 w-6 place-items-center rounded hover:bg-[var(--glass-bg)]" aria-expanded={isOpen} aria-label={`${isOpen ? "Свернуть" : "Раскрыть"} ${d.date}`} onClick={(e) => { e.stopPropagation(); toggle(d.date); }}>
                                {isOpen ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                              </button>
                            </td>
                            <td className="whitespace-nowrap">{d.date}</td>
                            <td><span className="inline-flex items-center gap-1"><StatusMark status={d.status} />{dayIssues.length > 0 && <span className="text-xs text-muted-foreground">{dayIssues.length}</span>}</span></td>
                            <td className="text-right">{d.journal.trades}</td>
                            <td className="text-right">{money(d.journal.gross)}</td>
                            <td className="text-right">{money(d.journal.fees)}</td>
                            <td className={cn("text-right font-medium", toneOfMoney(d.journal.net) === "up" ? "text-up" : toneOfMoney(d.journal.net) === "down" ? "text-down" : "")}>{signed(d.journal.net)}</td>
                            <td className="text-right">{d.broker ? signed(d.broker.net) : "—"}</td>
                            <td className="text-right">{diff == null ? "—" : signed(Math.round(diff * 100) / 100)}</td>
                            <td className="text-right text-muted-foreground">{d.manual.trades || ""}</td>
                          </tr>
                          {isOpen && (
                            <tr>
                              <td colSpan={10} className="bg-[var(--glass-bg)]"><DayDetails day={d} issues={dayIssues} trader={scopeName} /></td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </DataTable>
            )}
          </section>

          <section aria-labelledby="rc-issues-title" className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="rc-issues-title" className="text-sm font-semibold">Расхождения <span className="font-normal text-muted-foreground">(✗ {s.counts.error} · ⚠ {s.counts.warn})</span></h3>
              <div className="flex gap-1" role="group" aria-label="Фильтр расхождений">
                {(["all", "error", "warn"] as const).map((f) => (
                  <Button key={f} type="button" size="sm" variant={issueFilter === f ? "secondary" : "ghost"} aria-pressed={issueFilter === f} onClick={() => setIssueFilter(f)}>
                    {f === "all" ? "Все" : f === "error" ? "✗ серьёзные" : "⚠ мелкие"}
                  </Button>
                ))}
              </div>
            </div>
            {issues.length === 0 ? (
              <p className="text-xs text-muted-foreground">Нет расхождений ✓</p>
            ) : (
              <ul className="grid max-h-[50vh] gap-2 overflow-auto pr-1">{issues.slice(0, 300).map((i) => <IssueItem key={i.id} issue={i} trader={scopeName} />)}</ul>
            )}
            {(issues.length > 300 || data.issuesTruncated) && <p className="text-xs text-muted-foreground">Показаны первые 300 — полный список в CSV.</p>}
          </section>
        </div>
      )}
    </Panel>
  );
}

export default ReconcilePanel;
