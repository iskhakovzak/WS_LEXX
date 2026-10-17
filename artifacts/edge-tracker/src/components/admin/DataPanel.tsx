import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRight, CheckCircle2, Database, Download, FileJson, History, Plug, RefreshCw, Settings2, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-error";
import { DataTable, EmptyState, FilterChip, ListSkeleton, Panel, Pill, StatRow, type Tone } from "@/components/ds";
import { useToast } from "@/hooks/use-toast";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { useRuns, useStatus } from "@/components/propreports/api";
import { adminUrl, downloadBlob, errorFrom, fmtDateTime, timeAgo } from "./api";
import { useDataQuality, useHealth, type DataCheck } from "./console-api";

const EXPORT_TABLES: { key: string; label: string }[] = [
  { key: "trades", label: "Сделки" },
  { key: "playbook", label: "Плейбук" },
  { key: "tradeIdeas", label: "Идеи" },
  { key: "watchlist", label: "Вотчлист" },
  { key: "marketEvents", label: "События" },
  { key: "research", label: "Исследования" },
  { key: "tradingRules", label: "Правила" },
  { key: "big7Tickers", label: "Big7 тикеры" },
  { key: "big7Levels", label: "Big7 уровни" },
  { key: "big7Catalysts", label: "Big7 катализаторы" },
  { key: "users", label: "Пользователи" },
];

/**
 * «Данные и интеграции»: PropReports status/schedule (read-only — imports, account mapping and reconciliation
 * live on /integrations, the single place for PropReports operations), import history, data-quality checks,
 * exports and backups.
 */
export function DataPanel({ actor, isAdmin }: { actor: string; isAdmin: boolean }) {
  return (
    <div className="flex flex-col gap-[var(--grid-gap)]">
      <div className="grid grid-cols-1 items-start gap-[var(--grid-gap)] xl:grid-cols-2">
        <IntegrationStatusCard />
        <ImportHistoryCard />
      </div>
      <DataQualityCard />
      <div className="grid grid-cols-1 items-start gap-[var(--grid-gap)] xl:grid-cols-2">
        <ExportCard actor={actor} />
        <BackupsCard actor={actor} isAdmin={isAdmin} />
      </div>
      <Panel title="Другие инструменты" icon={Settings2}>
        <ul className="grid grid-cols-1 gap-x-4 md:grid-cols-3">
          {[
            { href: "/integrations", label: "Интеграции", desc: "Импорт отчётов PropReports, счета, сверка, история" },
            { href: "/error-tracker", label: "Правила и нарушения", desc: "Риск-правила трейдеров и журнал нарушений" },
            { href: "/scaling", label: "План масштабирования", desc: "Лестница тиров, предложения, история" },
          ].map((it) => (
            <li key={it.href}>
              <Link href={it.href} className="group flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-[var(--glass-bg)]">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{it.label}</div>
                  <div className="text-xs text-muted-foreground">{it.desc}</div>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function IntegrationStatusCard() {
  const status = useStatus();
  const health = useHealth();
  const st = status.data;
  const errors = health.data?.errors24h;
  return (
    <Panel
      title="PropReports: статус и расписание"
      icon={Plug}
      description="Только просмотр. Импорт, счета и сверка — в «Интеграциях»."
      actions={<Button asChild variant="outline" size="sm"><Link href="/integrations">Интеграции <ArrowRight /></Link></Button>}
    >
      {status.isError ? (
        <QueryError error={status.error} onRetry={() => status.refetch()} />
      ) : !st ? (
        <ListSkeleton rows={5} dense />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col">
            <StatRow
              label="Подключение по API"
              value={st.config.configured
                ? <Pill tone="up" dot>настроено · {st.config.authMode === "token" ? "токен" : "логин"}</Pill>
                : <Pill tone="neutral">не настроено</Pill>}
            />
            {!st.config.configured && st.config.missing.length > 0 && (
              <p className="pb-1 text-xs text-muted-foreground">
                Не заданы переменные окружения: {st.config.missing.map((m, i) => <span key={m}>{i > 0 && ", "}<code>{m}</code></span>)}. Пока сделки загружаются из файлов отчёта.
              </p>
            )}
            <StatRow
              label="Расписание синка"
              value={st.scheduler.enabled
                ? `каждые ${st.scheduler.minutes} мин`
                : st.config.syncMinutes ? `каждые ${st.config.syncMinutes} мин (не запущено)` : "выключено"}
              tone={st.scheduler.enabled ? "up" : "neutral"}
            />
            {st.scheduler.enabled && (
              <StatRow label="Следующий запуск" value={st.scheduler.running ? "идёт сейчас" : st.scheduler.nextRunAt ? fmtDateTime(st.scheduler.nextRunAt) : "—"} />
            )}
            <StatRow label="Последний синк" value={st.lastRun ? `${timeAgo(st.lastRun.startedAt)} · ${st.lastRun.source === "file" ? "файл" : "API"}` : "ещё не было"} />
            <StatRow label="Сделок из брокера" value={st.trades.imported} />
            <StatRow
              label="Счета"
              value={`${st.accounts.mapped}/${st.accounts.total} привязано${st.settings.unmatched.length ? ` · новых ${st.settings.unmatched.length}` : ""}`}
              tone={st.accounts.unmapped.length || st.settings.unmatched.length ? "warn" : "neutral"}
            />
            <StatRow label="Ждут сверки" value={st.pendingCount} tone={st.pendingCount ? "warn" : "neutral"} />
            <StatRow label="Комиссии" value={st.settings.feesConfirmedAt ? "подтверждены" : "не подтверждены"} tone={st.settings.feesConfirmedAt ? "neutral" : "warn"} />
          </div>
          <div className="rounded-xl bg-[var(--glass-bg)] p-3">
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-foreground">Ошибки за 24 ч</span>
              <Pill tone={errors?.count ? "down" : "up"}>{errors ? errors.count : "—"}</Pill>
            </div>
            {errors && errors.items.length > 0 ? (
              <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                {errors.items.slice(0, 5).map((e, i) => (
                  <li key={i} className="truncate" title={e.text}>{e.at ? `${fmtDateTime(e.at)} · ` : ""}{e.text}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">Ошибок синка и планировщика нет.</p>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

const RUN_STATUS: Record<string, { label: string; tone: Tone }> = {
  ok: { label: "успешно", tone: "up" },
  partial: { label: "частично", tone: "warn" },
  error: { label: "ошибка", tone: "down" },
  running: { label: "идёт", tone: "accent" },
};

function ImportHistoryCard() {
  const runs = useRuns(10);
  return (
    <Panel
      title="История импорта"
      icon={History}
      description="Последние 10 загрузок сделок"
      actions={<Button asChild variant="ghost" size="sm"><Link href="/integrations?tab=history">Вся история <ArrowRight /></Link></Button>}
    >
      {runs.isError ? (
        <QueryError error={runs.error} onRetry={() => runs.refetch()} />
      ) : runs.isLoading ? (
        <ListSkeleton rows={4} dense />
      ) : !runs.data?.length ? (
        <EmptyState compact icon={History} title="Импортов ещё не было" description="Отчёт PropReports загружается в «Интеграциях»." />
      ) : (
        <DataTable ariaLabel="История импорта" maxHeight={360}>
          <table>
            <thead>
              <tr>
                <th scope="col">Когда</th>
                <th scope="col">Источник</th>
                <th scope="col">Итог</th>
                <th scope="col" className="text-right">Новых</th>
                <th scope="col" className="text-right">Обновлено</th>
                <th scope="col" className="text-right">Сверка</th>
              </tr>
            </thead>
            <tbody>
              {runs.data.map((r) => {
                const s = RUN_STATUS[r.status] ?? { label: r.status, tone: "neutral" as Tone };
                return (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap tabular-nums" title={new Date(r.startedAt).toLocaleString("ru-RU")}>{fmtDateTime(r.startedAt)}</td>
                    <td className="max-w-[14rem] truncate" title={r.fileName ?? undefined}>
                      {r.source === "file" ? (r.fileName ?? "файл") : "API"}
                      {r.actor ? <span className="text-muted-foreground"> · {r.actor}</span> : null}
                    </td>
                    <td>
                      <Pill tone={s.tone} dot>{s.label}</Pill>
                      {r.errorText && <div className="max-w-[12rem] truncate text-2xs text-down" title={r.errorText}>{r.errorText}</div>}
                    </td>
                    <td className="text-right tabular-nums">{r.inserted}</td>
                    <td className="text-right tabular-nums">{r.updated}</td>
                    <td className="text-right tabular-nums">{r.conflicts || <span className="text-muted-foreground">0</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataTable>
      )}
    </Panel>
  );
}

const SEVERITY: Record<DataCheck["severity"], { label: string; tone: Tone }> = {
  high: { label: "важно", tone: "down" },
  medium: { label: "проверить", tone: "warn" },
  low: { label: "мелочь", tone: "neutral" },
};

const CHECK_LINK: Record<string, { href: string; label: string }> = {
  no_trader: { href: "/integrations?tab=accounts", label: "Счета" },
  unmapped_account: { href: "/integrations?tab=accounts", label: "Счета" },
  unknown_trader: { href: "/integrations?tab=accounts", label: "Счета" },
  duplicates: { href: "/integrations?tab=reconcile", label: "Сверка" },
  pending_reconcile: { href: "/integrations?tab=reconcile", label: "Сверка" },
};

function sampleText(row: Record<string, unknown>): string {
  if (Array.isArray(row.ids)) return `${row.trader ?? "?"} · ${row.ticker ?? ""} · ${row.date ?? ""} · ${row.n} шт (#${(row.ids as unknown[]).join(", #")})`;
  if (row.account && row.n != null) return `Счёт ${row.account}: ${row.n} сделок`;
  const parts = [row.date, row.ticker, row.trader ?? "без трейдера"];
  if (row.openedDate) parts.push(`открыта ${row.openedDate}`);
  if (row.exitDate) parts.push(`выход ${row.exitDate}`);
  return parts.filter(Boolean).map(String).join(" · ");
}

function DataQualityCard() {
  const quality = useDataQuality();
  const [showAll, setShowAll] = useState(false);
  const checks = quality.data?.checks ?? [];
  const problems = checks.filter((c) => c.count > 0);
  const visible = showAll ? checks : problems;
  return (
    <Panel
      title="Качество данных"
      icon={ShieldCheck}
      description="Сделки без трейдера, дубликаты, даты не по Нью-Йорку. Только проверка — автоматически ничего не меняется."
      actions={
        <>
          {checks.length > 0 && <FilterChip active={showAll} onClick={() => setShowAll((v) => !v)}>Все проверки</FilterChip>}
          <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Проверить заново" onClick={() => quality.refetch()} disabled={quality.isFetching}>
            <RefreshCw className={cn(quality.isFetching && "animate-spin motion-reduce:animate-none")} />
          </Button>
        </>
      }
    >
      {quality.isError ? (
        <QueryError error={quality.error} onRetry={() => quality.refetch()} />
      ) : quality.isLoading ? (
        <ListSkeleton rows={4} />
      ) : quality.data === null || quality.data === undefined ? (
        <EmptyState compact icon={AlertTriangle} title="Проверка ещё не подключена" description="Появится после перезапуска API (новый роутер admin-console)." />
      ) : visible.length === 0 ? (
        <EmptyState compact icon={CheckCircle2} title="Проблем не найдено" description={`Проверено правил: ${checks.length} · ${fmtDateTime(quality.data.generatedAt)}`} />
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((c) => {
            const sev = SEVERITY[c.severity] ?? SEVERITY.low;
            const link = CHECK_LINK[c.key];
            return (
              <li key={c.key} className="rounded-xl bg-[var(--glass-bg)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{c.label}</span>
                  <Pill tone={c.count ? sev.tone : "up"}>{c.count ? `${c.count}${c.groups ? ` в ${c.groups} группах` : ""}` : "ок"}</Pill>
                  {c.count > 0 && <span className="text-2xs uppercase tracking-wide text-muted-foreground">{sev.label}</span>}
                  {link && c.count > 0 && (
                    <Button asChild variant="ghost" size="sm" className="ml-auto h-7">
                      <Link href={link.href}>{link.label} <ArrowRight /></Link>
                    </Button>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{c.hint}</p>
                {c.sample.length > 0 && (
                  <details className="mt-1.5 text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Примеры ({Math.min(c.sample.length, 25)})</summary>
                    <ul className="mt-1 flex flex-col gap-0.5 tabular-nums">
                      {c.sample.slice(0, 25).map((row, i) => (
                        <li key={i} className="truncate">
                          {typeof row.id === "number"
                            ? <Link href={links.trade(row.id)} className="text-primary underline-offset-2 hover:underline">#{row.id}</Link>
                            : null}{" "}
                          {sampleText(row)}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function ExportCard({ actor }: { actor: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(EXPORT_TABLES.map((t) => t.key)));
  const [busy, setBusy] = useState(false);
  const all = picked.size === EXPORT_TABLES.length;

  const toggle = (k: string) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  async function run() {
    if (!picked.size) return;
    setBusy(true);
    try {
      const r = await fetch(adminUrl("/admin/db-export", actor, { tables: all ? undefined : [...picked].join(",") }));
      if (!r.ok) throw await errorFrom(r, "Не удалось выгрузить данные");
      const text = await r.text();
      const day = new Date().toISOString().slice(0, 10);
      downloadBlob(text, `ws-lexx-${all ? "backup" : "export"}-${day}.json`, "application/json");
      let summary = "";
      try {
        const j = JSON.parse(text) as { summary?: Record<string, number> };
        const total = Object.values(j.summary ?? {}).reduce((s, v) => s + v, 0);
        summary = `${total.toLocaleString("ru-RU")} записей`;
      } catch { /* ignore */ }
      qc.invalidateQueries({ queryKey: ["admin-audit"] });
      toast({ title: "Экспорт готов", description: summary || undefined });
    } catch (e) {
      toast({ title: "Ошибка экспорта", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Экспорт данных"
      description="JSON-выгрузка таблиц БД. Полный набор — совместим с импортом бэкапа в «Настройках»."
      icon={FileJson}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Таблицы для экспорта">
          <FilterChip active={all} onClick={() => setPicked(all ? new Set() : new Set(EXPORT_TABLES.map((t) => t.key)))}>Все</FilterChip>
          {EXPORT_TABLES.map((t) => (
            <FilterChip key={t.key} active={picked.has(t.key)} onClick={() => toggle(t.key)}>{t.label}</FilterChip>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {all ? "Полный бэкап" : `${picked.size} из ${EXPORT_TABLES.length} таблиц`} · пароли не выгружаются · действие пишется в аудит
          </span>
          <Button onClick={run} disabled={busy || !picked.size}>
            <Download /> {busy ? "Готовлю…" : "Скачать JSON"}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

interface BackupMeta { name: string; objectName: string; createdAt: string; sizeKb: number }

function fmtMsk(iso: string) {
  try {
    return new Date(iso).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " МСК";
  } catch { return iso; }
}

function BackupsCard({ actor, isAdmin }: { actor: string; isAdmin: boolean }) {
  const { toast } = useToast();
  const [triggering, setTriggering] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const { data: backups, isLoading, isError, error, refetch, isFetching } = useQuery<BackupMeta[]>({
    queryKey: ["admin-backups", actor],
    queryFn: async () => {
      const r = await fetch(adminUrl("/admin/backups", actor));
      if (!r.ok) throw await errorFrom(r, "Не удалось получить список бэкапов");
      return r.json();
    },
    retry: false,
  });

  async function trigger() {
    setTriggering(true);
    try {
      const r = await fetch(adminUrl("/admin/backups/trigger", actor), { method: "POST" });
      if (!r.ok) throw await errorFrom(r, "Не удалось создать бэкап");
      const d = await r.json();
      toast({ title: "Бэкап создан", description: `${d.name} · ${d.sizeKb} KB` });
      refetch();
    } catch (e) {
      toast({ title: "Ошибка", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setTriggering(false);
    }
  }

  async function download(name: string) {
    setDownloading(name);
    try {
      const r = await fetch(adminUrl(`/admin/backups/${encodeURIComponent(name)}/download`, actor));
      if (!r.ok) throw await errorFrom(r, "Не удалось получить ссылку");
      const d = await r.json();
      const a = document.createElement("a");
      a.href = d.url;
      a.download = `${name}.sql.gz`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      toast({ title: "Ошибка скачивания", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setDownloading(null);
    }
  }

  return (
    <Panel
      title="Бэкапы БД"
      description="pg_dump автоматически каждые 48 ч, хранятся последние 10"
      icon={Database}
      actions={
        <>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Обновить список бэкапов" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn(isFetching && "animate-spin")} />
          </Button>
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={trigger} disabled={triggering} data-testid="button-trigger-backup">
              {triggering ? "Создаётся…" : "Создать сейчас"}
            </Button>
          )}
        </>
      }
    >
      {isLoading ? (
        <div className="flex flex-col gap-2">{[0, 1].map((i) => <Skeleton key={i} className="h-11 w-full rounded-xl" />)}</div>
      ) : isError ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-down">
          {error instanceof Error ? error.message : "Не удалось получить список бэкапов"}
          <Button variant="link" size="sm" onClick={() => refetch()}>Повторить</Button>
        </div>
      ) : !backups || backups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Бэкапов пока нет. Первый создастся автоматически через 3 минуты после старта сервера{isAdmin ? " — или нажмите «Создать сейчас»" : ""}.
          {!isAdmin && <span className="mt-1 block text-xs">Скачивание доступно только администраторам.</span>}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <ul className="flex flex-col">
            {backups.map((b, i) => (
              <li key={b.name} className="flex items-center justify-between gap-2 rounded-xl px-2 py-2 hover:bg-[var(--glass-bg)]">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm tabular-nums">
                    {fmtMsk(b.createdAt)}
                    {i === 0 && <Pill tone="up">последний</Pill>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{b.sizeKb.toLocaleString("ru-RU")} KB · {b.name}.sql.gz</div>
                </div>
                {isAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => download(b.name)}
                    disabled={downloading === b.name}
                    aria-label={`Скачать бэкап ${b.name}`}
                    data-testid={`button-download-backup-${b.name}`}
                  >
                    <Download /> {downloading === b.name ? "…" : "SQL.GZ"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <p className="px-2 pt-1 text-xs text-muted-foreground">Восстановление: <code>pg_restore</code> или <code>psql</code></p>
        </div>
      )}
    </Panel>
  );
}
