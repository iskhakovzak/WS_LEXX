/**
 * Drag-and-drop import: Fills CSV (recommended) or Trades report XLS/CSV → dry-run preview → «Импортировать».
 * The preview request uses ?dryRun=1 (server side provably write-free); the apply request is a second explicit click.
 */
import * as React from "react";
import { FileUp, Loader2, Upload, X } from "lucide-react";
import { Panel, Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { isPerformanceResponse, useImportFile, useUsers, type AccountMapping, type ApplyResult, type ImportKind, type PerformancePreview, type Preview } from "./api";
import { PreviewSummary, PreviewTable } from "./preview-table";
import { PerformanceReportBody } from "./PerformanceReportPanel";
import { PersonSelect } from "@/components/people/person-select";

type Kind = ImportKind;

export function ImportZone({ accounts, staff, viewerName }: { accounts: AccountMapping[]; staff: boolean; viewerName?: string }) {
  const { toast } = useToast();
  const [perf, setPerf] = React.useState<PerformancePreview | null>(null);
  const [perfTrader, setPerfTrader] = React.useState<string>("");
  const users = useUsers(staff);
  const [file, setFile] = React.useState<File | null>(null);
  const [kind, setKind] = React.useState<Kind>("auto");
  const [account, setAccount] = React.useState<string>("");
  const [drag, setDrag] = React.useState(false);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [applied, setApplied] = React.useState<ApplyResult | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const importFile = useImportFile();

  // XLS/XLSX: the server tells Trade Performance (aggregate) from Trades by content; the account is only
  // required for the Trades report.
  const isReport = kind === "trades";
  const needAccount = isReport && !account;

  const pick = (f: File | null) => {
    setFile(f); setPreview(null); setApplied(null); setPerf(null);
    if (f && /\.xlsx?$/i.test(f.name) && kind === "auto") setKind(/performance/i.test(f.name) ? "performance" : "trades");
  };

  const runPreview = async () => {
    if (!file) return;
    try {
      const r = await importFile.mutateAsync({ file, dryRun: true, kind, account: isReport ? account : undefined, trader: perfTrader || undefined });
      if (isPerformanceResponse(r)) { setPerf(r); setPreview(null); setPerfTrader(r.trader ?? (staff ? "" : viewerName ?? "")); setApplied(null); return; }
      setPreview(r as Preview); setPerf(null); setApplied(null);
    } catch (e) {
      toast({ title: "Не удалось разобрать файл", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const runApplyPerformance = async () => {
    if (!file || !perf) return;
    try {
      const r = await importFile.mutateAsync({ file, dryRun: false, kind: "performance", account: perf.account, trader: perfTrader || undefined });
      if (!isPerformanceResponse(r)) return;
      setPerf(r);
      toast({ title: r.replaced ? "Отчёт заменён" : "Отчёт сохранён", description: `${r.account} · ${r.periodFrom} — ${r.periodTo} · ${r.trader ?? "без трейдера"} · net ${r.summary.net.toFixed(2)}` });
    } catch (e) {
      toast({ title: "Отчёт не сохранён", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const runApply = async () => {
    if (!file || !preview) return;
    try {
      const r = (await importFile.mutateAsync({ file, dryRun: false, kind, account: isReport ? account : undefined })) as ApplyResult;
      setApplied(r);
      toast({ title: `Импорт завершён: +${r.inserted} новых, ${r.updated} обновлено`, description: `${r.conflicts} на сверку · ${r.skipped} пропущено${r.errors ? ` · ошибок: ${r.errors}` : ""}`, variant: r.errors ? "destructive" : undefined });
    } catch (e) {
      toast({ title: "Импорт не выполнен", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) pick(f);
  };

  const writable = preview && (preview.counts.insert + preview.counts.update + preview.counts.adopt + preview.counts.conflict) > 0;

  return (
    <Panel title="Импорт файла" description="Fills CSV (рекомендуется: исполнения, комиссии по типам, овернайт/свинг), отчёт Trades (XLS/CSV) или Trade Performance (XLS, только статистика) из веб-интерфейса PropReports" icon={FileUp}>
      <div className="grid gap-4">
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors",
            drag ? "border-primary bg-primary/5" : "border-[var(--glass-border)] hover:border-primary/60",
          )}
          aria-label="Перетащите файл или нажмите, чтобы выбрать"
        >
          <Upload className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          {file ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">{file.name}</span>
              <span className="text-muted-foreground">{(file.size / 1024).toFixed(0)} КБ</span>
              <button type="button" className="rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={(e) => { e.stopPropagation(); pick(null); }} aria-label="Убрать файл"><X className="h-4 w-4" /></button>
            </div>
          ) : (
            <>
              <div className="text-sm">Перетащите файл сюда или нажмите, чтобы выбрать</div>
              <div className="text-xs text-muted-foreground">.csv, .txt, .xls, .xlsx · до 15 МБ · в PropReports: Fills → Export, Reports → Trades → Export, Reports → Trade Performance → Export (статистика)</div>
            </>
          )}
          <input ref={inputRef} type="file" accept=".csv,.txt,.xls,.xlsx" className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Формат</Label>
            <Select value={kind} onValueChange={(v) => { setKind(v as Kind); setPreview(null); }}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Определить автоматически</SelectItem>
                <SelectItem value="fills">Fills CSV</SelectItem>
                <SelectItem value="trades">Отчёт Trades</SelectItem>
                <SelectItem value="performance">Отчёт Trade Performance (статистика)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {isReport && (
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">Брокерский счёт (в отчёте Trades нет колонки счёта)</Label>
              <Select value={account} onValueChange={(v) => { setAccount(v); setPreview(null); }}>
                <SelectTrigger className="w-60"><SelectValue placeholder="Выберите счёт" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => <SelectItem key={a.id} value={a.account}>{a.account}{a.trader ? ` — ${a.trader}` : " (не привязан)"}</SelectItem>)}
                  {!accounts.length && <SelectItem value="__none" disabled>Сначала добавьте счёт в привязке ниже</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button variant="outline" onClick={runPreview} disabled={!file || needAccount || importFile.isPending}>
            {importFile.isPending && importFile.variables?.dryRun ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Предпросмотр (без записи)
          </Button>
          {!perf && (
            <Button onClick={runApply} disabled={!preview || !writable || importFile.isPending || !!applied}>
              {importFile.isPending && importFile.variables?.dryRun === false ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Импортировать
            </Button>
          )}
          {!staff && <Pill tone="neutral">Импортируются только ваши счета</Pill>}
        </div>

        {applied && (
          <div className="rounded-xl border border-[var(--glass-border)] p-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Pill tone="up">+{applied.inserted} новых</Pill>
              <Pill tone="accent">{applied.updated} обновлено</Pill>
              <Pill tone="neutral">{applied.unchanged} без изменений</Pill>
              {applied.conflicts > 0 && <Pill tone="warn">{applied.conflicts} на сверку</Pill>}
              {applied.skipped > 0 && <Pill tone="neutral">{applied.skipped} пропущено</Pill>}
              {applied.errors > 0 && <Pill tone="down">{applied.errors} ошибок</Pill>}
            </div>
            {applied.errorText && <pre className="mt-2 whitespace-pre-wrap text-xs text-down">{applied.errorText}</pre>}
          </div>
        )}

        {perf && (
          <div className="grid gap-3 rounded-xl border border-[var(--glass-border)] p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Pill tone="purple">Trade Performance</Pill>
              <span>счёт <b>{perf.account}</b></span>
              <span className="text-muted-foreground">{perf.periodFrom} — {perf.periodTo}</span>
              <Pill tone="neutral">{perf.symbols} тикеров</Pill>
              {perf.traderSource && perf.traderSource !== "manual" && <Pill tone="accent">трейдер по привязке счёта</Pill>}
              {perf.dryRun === false && <Pill tone="up">{perf.replaced ? "заменён" : "сохранён"} #{perf.reportId}</Pill>}
            </div>
            <p className="text-xs text-muted-foreground">{perf.note}</p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="grid gap-1">
                <Label className="text-xs text-muted-foreground">Трейдер</Label>
                {staff ? (
                  <PersonSelect value={perfTrader} onValueChange={setPerfTrader} options={(users.data ?? []).filter((u) => u.active).map((u) => u.name)} placeholder="Выберите трейдера" ariaLabel="Трейдер" className="w-56" />
                ) : (
                  <div className="text-sm font-medium">{perfTrader || viewerName}</div>
                )}
              </div>
              <Button onClick={runApplyPerformance} disabled={!perfTrader || importFile.isPending || perf.dryRun === false}>
                {importFile.isPending && importFile.variables?.dryRun === false ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {perf.dryRun === false ? "Сохранено" : "Импортировать статистику"}
              </Button>
            </div>
            <PerformanceReportBody data={{ format: "trade-performance", perTradeAverages: perf.perTradeAverages, totals: null, bySide: perf.bySide, byTime: perf.byTime, byWeekday: perf.byWeekday, bySymbol: [], other: [], summary: perf.summary, issues: perf.issues }} compact />
          </div>
        )}

        {preview && !applied && !perf && (
          <div className="grid gap-3">
            <PreviewSummary preview={preview} />
            <PreviewTable preview={preview} />
          </div>
        )}
      </div>
    </Panel>
  );
}
