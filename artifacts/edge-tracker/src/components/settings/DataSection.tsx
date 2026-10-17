import * as React from "react";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle, Archive, BookOpen, CalendarDays, CheckCircle2, Database, Download, FileJson, FileSearch, Info,
  LineChart, ListChecks, MessagesSquare, Newspaper, ScrollText, Target, Upload, XCircle, Eye,
} from "lucide-react";
import { useListDailyFeed, useListDiscussions, useListEvents, useListResearch, useListTrades } from "@workspace/api-client-react";
import { useTradesBookFacets } from "@/hooks/use-trades-window";
import { Panel, Pill, Segmented, SortableTh, StatCard, useTableSort } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { BASE } from "@/lib/api";
import { downloadBlob } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Callout, fmtDate } from "./shared";

/** Serialises an array of flat-ish JSON records to CSV (RFC 4180 quoting, UTF-8 BOM for Excel). */
function toCsv(rows: Record<string, unknown>[]): string {
  const headers: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!headers.includes(k)) headers.push(k);
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(cell).join(","), ...rows.map((r) => headers.map((h) => cell(r[h])).join(","))];
  return "﻿" + lines.join("\r\n");
}

function saveText(text: string, mime: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  downloadBlob(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Period = "all" | "30" | "90" | "365";

const EXPORTS: { key: string; label: string; endpoint: string; filename: string; icon: React.ElementType }[] = [
  { key: "trades", label: "Сделки", endpoint: "/trades", filename: "trades", icon: LineChart },
  { key: "events", label: "События", endpoint: "/events", filename: "events", icon: CalendarDays },
  { key: "research", label: "Исследования", endpoint: "/research", filename: "research", icon: FileSearch },
  { key: "dailyfeed", label: "Дневная лента", endpoint: "/dailyfeed", filename: "dailyfeed", icon: Newspaper },
  { key: "discussions", label: "Обсуждения", endpoint: "/discussions", filename: "discussions", icon: MessagesSquare },
  { key: "watchlist", label: "Вотчлист", endpoint: "/watchlist", filename: "watchlist", icon: Eye },
  { key: "playbook", label: "Плейбук", endpoint: "/playbook", filename: "playbook", icon: BookOpen },
  { key: "errors", label: "Ошибки", endpoint: "/errors", filename: "trading-errors", icon: ListChecks },
  { key: "big7", label: "Big7 уровни", endpoint: "/big7levels", filename: "big7-levels", icon: Target },
];

function cutoffFor(p: Period): string | null {
  if (p === "all") return null;
  const d = new Date();
  d.setDate(d.getDate() - Number(p));
  return d.toISOString().slice(0, 10);
}

function ExportTile({ item, period, count }: { item: (typeof EXPORTS)[number]; period: Period; count?: number }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  async function run() {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api${item.endpoint}`);
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({ title: `Не удалось скачать: ${item.label}`, description: data?.error ?? `HTTP ${res.status}`, variant: "destructive" });
        return;
      }
      const data = (await res.json()) as unknown;
      if (!Array.isArray(data)) throw new Error("bad shape");
      const cutoff = cutoffFor(period);
      const rows = (data as Record<string, unknown>[]).filter((r) => {
        if (!cutoff) return true;
        const d = r.date ?? r.createdAt ?? r.created_at;
        return typeof d !== "string" || d.slice(0, 10) >= cutoff;
      });
      if (rows.length === 0) { toast({ title: `${item.label}: нет данных за период` }); return; }
      const suffix = period === "all" ? "" : `-${period}d`;
      const filename = `${item.filename}${suffix}-${new Date().toISOString().slice(0, 10)}.csv`;
      saveText(toCsv(rows), "text/csv;charset=utf-8", filename);
      toast({ title: `Скачан ${filename}`, description: `${rows.length} строк` });
    } catch {
      toast({ title: "Ошибка экспорта", description: `Экспорт «${item.label}» не выполнен`, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }
  return (
    <button type="button" onClick={run} disabled={loading} aria-label={`Скачать CSV: ${item.label}`}
      className="lift group flex items-center gap-3 rounded-xl bg-[var(--glass-bg)] px-3 py-3 text-left hover:bg-[var(--glass-hover-bg)] disabled:opacity-60">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--glass-thick-bg)] text-muted-foreground group-hover:text-primary">
        <item.icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{item.label}</span>
        <span className="block text-xs text-muted-foreground tabular-nums">{count != null ? `${count.toLocaleString("ru-RU")} записей` : "CSV"}</span>
      </span>
      <Download className={cn("h-4 w-4 shrink-0 text-muted-foreground", loading && "animate-pulse")} aria-hidden="true" />
    </button>
  );
}

// ─── Backup inspector (dry run, local) ───────────────────────────────────────

type TableCheck = { key: string; rows: number; ids: number; duplicateIds: number; missingIds: number; minId: number | null; maxId: number | null };
type Inspection = {
  fileName: string;
  sizeKb: number;
  format: "db-export" | "legacy";
  exportedAt: string | null;
  database: string | null;
  tables: TableCheck[];
  summaryMismatch: string[];
  unknownKeys: string[];
};

const TABLE_LABELS: Record<string, string> = {
  playbook: "Плейбук", trades: "Сделки", users: "Пользователи", big7Tickers: "Big7 тикеры", big7Levels: "Big7 уровни",
  big7Catalysts: "Big7 катализаторы", marketEvents: "События", tradeIdeas: "Идеи", tradingRules: "Правила",
  watchlist: "Вотчлист", research: "Исследования", events: "События", dailyFeed: "Дневная лента",
  discussions: "Обсуждения", comments: "Комментарии", activityLog: "Активность", tradeReactions: "Реакции",
  tradeReviews: "Ревью", tradingErrors: "Ошибки",
};

function checkTable(key: string, rows: unknown[]): TableCheck {
  const seen = new Set<number>();
  let dup = 0, missing = 0, min: number | null = null, max: number | null = null;
  for (const r of rows) {
    const id = r && typeof r === "object" ? Number((r as Record<string, unknown>).id) : NaN;
    if (!Number.isFinite(id)) { missing++; continue; }
    if (seen.has(id)) dup++;
    seen.add(id);
    min = min == null ? id : Math.min(min, id);
    max = max == null ? id : Math.max(max, id);
  }
  return { key, rows: rows.length, ids: seen.size, duplicateIds: dup, missingIds: missing, minId: min, maxId: max };
}

function inspect(fileName: string, size: number, data: unknown): Inspection {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Ожидается JSON-объект бэкапа");
  const obj = data as Record<string, unknown>;
  const isDbExport = !!obj.tables && typeof obj.tables === "object" && !Array.isArray(obj.tables);
  const source = (isDbExport ? obj.tables : obj) as Record<string, unknown>;
  const tables: TableCheck[] = [];
  const unknownKeys: string[] = [];
  for (const [k, v] of Object.entries(source)) {
    if (Array.isArray(v)) tables.push(checkTable(k, v));
    else if (isDbExport) unknownKeys.push(k);
  }
  if (tables.length === 0) throw new Error("В файле не найдено ни одной таблицы с данными");
  const summaryMismatch: string[] = [];
  if (isDbExport && obj.summary && typeof obj.summary === "object") {
    for (const [k, v] of Object.entries(obj.summary as Record<string, unknown>)) {
      const t = tables.find((x) => x.key === k);
      if (typeof v === "number" && (!t || t.rows !== v)) summaryMismatch.push(`${TABLE_LABELS[k] ?? k}: в сводке ${v}, в файле ${t?.rows ?? 0}`);
    }
  }
  return {
    fileName, sizeKb: Math.round(size / 1024), format: isDbExport ? "db-export" : "legacy",
    exportedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : null,
    database: typeof obj.database === "string" ? obj.database : null,
    tables: tables.sort((a, b) => b.rows - a.rows), summaryMismatch, unknownKeys,
  };
}

const NO_TABLES: TableCheck[] = [];

function BackupInspector({ current }: { current: Record<string, number | undefined> }) {
  const [result, setResult] = useState<Inspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const accessors = React.useMemo(() => ({
    name: (t: TableCheck) => TABLE_LABELS[t.key] ?? t.key,
    rows: (t: TableCheck) => t.rows,
    now: (t: TableCheck) => current[t.key] ?? null,
    // problems first when sorted desc
    check: (t: TableCheck) => t.duplicateIds * 2 + t.missingIds,
  }), [current]);
  const sort = useTableSort(result?.tables ?? NO_TABLES, accessors, "rows", "desc", { name: "asc" });

  function readFile(file: File) {
    setError(null);
    setResult(null);
    if (file.size > 200 * 1024 * 1024) { setError("Файл больше 200 МБ — проверьте его на сервере"); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      try { setResult(inspect(file.name, file.size, JSON.parse(String(ev.target?.result ?? "")))); }
      catch (e) { setError(e instanceof SyntaxError ? "Файл не является корректным JSON" : e instanceof Error ? e.message : "Не удалось разобрать файл"); }
      if (fileRef.current) fileRef.current.value = "";
    };
    reader.onerror = () => setError("Не удалось прочитать файл");
    reader.readAsText(file, "utf-8");
  }

  const totalRows = result?.tables.reduce((a, t) => a + t.rows, 0) ?? 0;
  const issues = result ? result.tables.filter((t) => t.duplicateIds || t.missingIds).length + result.summaryMismatch.length : 0;

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) readFile(f); }}
        className={cn("flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center transition-colors",
          drag ? "border-primary bg-primary/10" : "border-border")}
      >
        <FileJson className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-foreground">Перетащите JSON-бэкап сюда</p>
        <p className="text-xs text-muted-foreground">Файл читается только в браузере — на сервер ничего не загружается</p>
        <input ref={fileRef} id="backup-inspect-input" type="file" accept=".json,application/json" className="sr-only"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); }} />
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} className="gap-1.5">
          <Upload className="h-3.5 w-3.5" aria-hidden="true" /> Выбрать файл
        </Button>
      </div>

      {error && <Callout tone="down" icon={XCircle}>{error}</Callout>}

      {result && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{result.fileName}</span>
            <Pill>{result.sizeKb.toLocaleString("ru-RU")} КБ</Pill>
            <Pill tone={result.format === "db-export" ? "accent" : "warn"}>{result.format === "db-export" ? "Полный бэкап БД" : "Старый формат"}</Pill>
            {result.exportedAt && <span>от {fmtDate(result.exportedAt)}</span>}
            {result.database && <span>· база {result.database}</span>}
          </div>
          <Callout tone={issues ? "warn" : "up"} icon={issues ? AlertTriangle : CheckCircle2}>
            {issues
              ? `Найдено проблем: ${issues}. Перед восстановлением проверьте таблицы, отмеченные ниже.`
              : `Файл цел: ${result.tables.length} таблиц, ${totalRows.toLocaleString("ru-RU")} строк, id без дублей.`}
          </Callout>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <SortableTh {...sort.thProps("name")} className="py-2 pr-3 font-normal">Таблица</SortableTh>
                  <SortableTh {...sort.thProps("rows")} align="right" className="py-2 pr-3 font-normal">В файле</SortableTh>
                  <SortableTh {...sort.thProps("now")} align="right" className="py-2 pr-3 font-normal">Сейчас</SortableTh>
                  <th scope="col" className="py-2 pr-3 font-normal">id</th>
                  <SortableTh {...sort.thProps("check")} className="py-2 font-normal">Проверка</SortableTh>
                </tr>
              </thead>
              <tbody>
                {sort.rows.map((t) => {
                  const now = current[t.key];
                  const ok = !t.duplicateIds && !t.missingIds;
                  return (
                    <tr key={t.key} className="border-b border-border/60 last:border-0">
                      <th scope="row" className="py-2 pr-3 text-left font-medium text-foreground">{TABLE_LABELS[t.key] ?? t.key}</th>
                      <td className="py-2 pr-3 text-right tabular-nums">{t.rows.toLocaleString("ru-RU")}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                        {now != null ? (
                          <span className={cn(now < t.rows && "text-down")}>{now.toLocaleString("ru-RU")}</span>
                        ) : "—"}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-xs tabular-nums text-muted-foreground">{t.minId != null ? `${t.minId}–${t.maxId}` : "—"}</td>
                      <td className="py-2">
                        {ok ? <Pill tone="up">ок</Pill> : (
                          <span className="flex flex-wrap gap-1">
                            {t.duplicateIds > 0 && <Pill tone="down">{t.duplicateIds} дубл. id</Pill>}
                            {t.missingIds > 0 && <Pill tone="warn">{t.missingIds} без id</Pill>}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {result.summaryMismatch.length > 0 && (
            <Callout tone="warn" icon={AlertTriangle}><ul className="space-y-0.5">{result.summaryMismatch.map((m) => <li key={m}>{m}</li>)}</ul></Callout>
          )}
          <p className="text-xs text-muted-foreground">«Сейчас» — записей в текущей базе; красным, если в базе меньше, чем в бэкапе (возможная потеря данных).</p>
        </div>
      )}
    </div>
  );
}

type ServerBackup = { name: string; createdAt: string; sizeKb: number };

function ServerSnapshots() {
  const { data, isLoading, isError } = useQuery<ServerBackup[]>({
    queryKey: ["admin", "backups", "settings"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/admin/backups`);
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  const latest = data?.[0];
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--glass-bg)] px-3 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Archive className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">Серверные снапшоты (pg_dump)</div>
          <div className="text-xs text-muted-foreground">
            {isLoading ? <Skeleton className="mt-1 h-3 w-40 rounded-full" />
              : isError ? "Недоступно"
              : latest ? `${data!.length} шт. · последний ${fmtDate(latest.createdAt)} · ${latest.sizeKb.toLocaleString("ru-RU")} КБ`
              : "Снапшотов пока нет (хранилище не настроено или бэкап не запускался)"}
          </div>
        </div>
      </div>
      <Button asChild size="sm" variant="outline"><Link href="/admin">Открыть в админке</Link></Button>
    </div>
  );
}

export function DataSection() {
  const { can } = useAuth();
  const { toast } = useToast();
  const [period, setPeriod] = useState<Period>("all");
  const [fullLoading, setFullLoading] = useState(false);
  // P1-5: the counter needs only the size of the book — /trades/page?limit=1 (summary.total). The legacy full
  // list is fetched only if that endpoint is unavailable. CSV export (ExportTile) still downloads the full list.
  const facets = useTradesBookFacets();
  const legacyTrades = useListTrades(undefined, { query: { queryKey: ["/api/trades"], enabled: facets.isFetched && facets.data == null } });
  const l1 = facets.isLoading || (facets.data == null && legacyTrades.isLoading);
  const tradesCount = facets.data?.total ?? legacyTrades.data?.length ?? 0;
  const { data: events = [], isLoading: l2 } = useListEvents();
  const { data: research = [], isLoading: l3 } = useListResearch();
  const { data: feed = [], isLoading: l4 } = useListDailyFeed();
  const { data: discussions = [], isLoading: l5 } = useListDiscussions();
  const loading = l1 || l2 || l3 || l4 || l5;
  const total = tradesCount + events.length + research.length + feed.length + discussions.length;

  const counts: Record<string, number | undefined> = loading ? {} : {
    trades: tradesCount, events: events.length, research: research.length, dailyfeed: feed.length, discussions: discussions.length,
  };
  // Keys used by the db-export format → current counts for the backup comparison.
  const currentForBackup: Record<string, number | undefined> = loading ? {} : {
    trades: tradesCount, marketEvents: events.length, events: events.length, research: research.length,
    dailyFeed: feed.length, discussions: discussions.length,
  };

  async function fullBackup() {
    setFullLoading(true);
    try {
      const r = await fetch(`${BASE}/api/admin/db-export`);
      if (!r.ok) {
        const d = (await r.json().catch(() => null)) as { error?: string } | null;
        toast({ title: "Бэкап не скачан", description: d?.error ?? `HTTP ${r.status}`, variant: "destructive" });
        return;
      }
      const text = await r.text();
      const filename = `ws-lexx-backup-${new Date().toISOString().slice(0, 10)}.json`;
      saveText(text, "application/json;charset=utf-8", filename);
      toast({ title: `Скачан ${filename}`, description: `${Math.round(text.length / 1024).toLocaleString("ru-RU")} КБ` });
    } catch {
      toast({ title: "Сетевая ошибка", variant: "destructive" });
    } finally {
      setFullLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-busy={loading}>
        {loading ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[76px] rounded-2xl" />) : (
          <>
            <StatCard label="Всего записей" value={total.toLocaleString("ru-RU")} tone="accent" icon={Database} />
            <StatCard label="Сделки" value={tradesCount.toLocaleString("ru-RU")} />
            <StatCard label="События" value={events.length.toLocaleString("ru-RU")} />
            <StatCard label="Исследования" value={research.length.toLocaleString("ru-RU")} />
            <StatCard label="Дневная лента" value={feed.length.toLocaleString("ru-RU")} />
            <StatCard label="Обсуждения" value={discussions.length.toLocaleString("ru-RU")} />
          </>
        )}
      </div>

      <Panel title="Экспорт в CSV" description="Открывается в Excel и Google Sheets (UTF-8)" icon={Download}
        actions={<Segmented<Period> ariaLabel="Период экспорта" size="sm" value={period} onChange={setPeriod}
          options={[{ value: "all", label: "Всё" }, { value: "30", label: "30 дн" }, { value: "90", label: "90 дн" }, { value: "365", label: "Год" }]} />}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {EXPORTS.map((e) => <ExportTile key={e.key} item={e} period={period} count={period === "all" ? counts[e.key] : undefined} />)}
        </div>
        {period !== "all" && <p className="mt-3 text-xs text-muted-foreground">Фильтр по дате записи; таблицы без даты выгружаются целиком.</p>}
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {can("admin.backups.read") && (
          <Panel title="Полный бэкап" description="Все ключевые таблицы одним JSON-файлом" icon={Archive}>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--glass-bg)] px-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">Скачать бэкап БД (JSON)</div>
                  <div className="text-xs text-muted-foreground">Сделки, плейбук, идеи, правила, вотчлист, события, Big7. Без паролей.</div>
                </div>
                <Button size="sm" variant="secondary" onClick={fullBackup} disabled={fullLoading} className="gap-1.5">
                  <Download className="h-3.5 w-3.5" aria-hidden="true" /> {fullLoading ? "Готовим…" : "Скачать"}
                </Button>
              </div>
              <ServerSnapshots />
            </div>
          </Panel>
        )}

        <Panel title="Проверка бэкапа" description="Пробный разбор файла перед восстановлением — без записи в базу" icon={ScrollText}>
          <BackupInspector current={currentForBackup} />
        </Panel>
      </div>

      <Callout icon={Info}>
        <strong className="font-medium text-foreground">Импорт отключён.</strong> Загрузка CSV и восстановление JSON-бэкапа через интерфейс
        убраны: на сервере нет эндпоинтов импорта, а повторная загрузка создавала бы дубликаты. Восстановление выполняет администратор
        сервера из снапшота pg_dump или JSON-бэкапа — проверьте файл выше и передайте его администратору.
      </Callout>
    </div>
  );
}
