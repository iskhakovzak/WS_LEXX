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
import { MAX_UPLOAD_BYTES, isPerformanceResponse, useImportFile, useUsers, type AccountMapping, type ApplyResult, type ImportKind, type IntegrationsTab, type PerformancePreview, type Preview } from "./api";
import { NextSteps, PreviewSummary, PreviewTable } from "./preview-table";
import { PerformanceReportBody } from "./PerformanceReportPanel";
import { PersonSelect } from "@/components/people/person-select";
import { propreportsI18n } from "@/i18n/ns/propreports";
import { commonI18n } from "@/i18n/ns/common";
import { personName } from "@/i18n";
import { fmtCount, fmtNum } from "@/lib/format";

type Kind = ImportKind;

export function ImportZone({ accounts, staff, viewerName, onGoTab }: { accounts: AccountMapping[]; staff: boolean; viewerName?: string; onGoTab?: (tab: IntegrationsTab) => void }) {
  const { toast } = useToast();
  const { t } = propreportsI18n.useT();
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

  // XLS/XLSX: the server tells Trade Performance (aggregate) from Trades by content. The Trades report has no account
  // column: staff pick the trader (the server takes the account from the file name and links it to that trader),
  // a trader picks one of their own accounts.
  const isReport = kind === "trades";
  const [reportTrader, setReportTrader] = React.useState<string>("");
  const fileAccount = /^(\d{3,})\b/.exec(file?.name ?? "")?.[1] ?? "";
  const fileOwner = accounts.find((a) => a.account === fileAccount)?.trader ?? null;
  const needAccount = isReport && (staff ? !reportTrader : !account);
  // Prefill: the file's account owner (staff) / the only possible account (a trader usually has one).
  React.useEffect(() => { if (fileOwner) setReportTrader(fileOwner); }, [fileOwner]);
  React.useEffect(() => {
    if (!staff && isReport && !account && accounts.length === 1) setAccount(accounts[0]!.account);
  }, [staff, isReport, account, accounts]);
  const reportTarget = () => (staff ? { account: undefined, trader: reportTrader } : { account, trader: undefined });

  const pick = (f: File | null) => {
    // the API (and Vercel's 4.5 MB body limit) refuses bigger uploads — say so before sending anything
    if (f && f.size > MAX_UPLOAD_BYTES) {
      toast({ title: t("import.tooLargeTitle", { max: "4 MB" }), description: t("import.tooLargeText"), variant: "destructive" });
      f = null;
    }
    setFile(f); setPreview(null); setApplied(null); setPerf(null);
    if (f && /\.xlsx?$/i.test(f.name) && kind === "auto") setKind(/performance/i.test(f.name) ? "performance" : "trades");
  };

  const runPreview = async () => {
    if (!file) return;
    try {
      const r = await importFile.mutateAsync({ file, dryRun: true, kind, ...(isReport ? reportTarget() : { trader: perfTrader || undefined }) });
      if (isPerformanceResponse(r)) { setPerf(r); setPreview(null); setPerfTrader(r.trader ?? (staff ? "" : viewerName ?? "")); setApplied(null); return; }
      setPreview(r as Preview); setPerf(null); setApplied(null);
    } catch (e) {
      toast({ title: t("import.parseFailed"), description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const runApplyPerformance = async () => {
    if (!file || !perf) return;
    try {
      const r = await importFile.mutateAsync({ file, dryRun: false, kind: "performance", account: perf.account, trader: perfTrader || undefined });
      if (!isPerformanceResponse(r)) return;
      setPerf(r);
      toast({
        title: r.replaced ? t("import.reportReplaced") : t("import.reportSaved"),
        description: t("import.reportToast", { account: r.account, from: r.periodFrom, to: r.periodTo, trader: r.trader ? personName(r.trader) : t("import.noTrader"), net: fmtNum(r.summary.net) }),
      });
    } catch (e) {
      toast({ title: t("import.reportNotSaved"), description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const runApply = async () => {
    if (!file || !preview) return;
    try {
      const r = (await importFile.mutateAsync({ file, dryRun: false, kind, ...(isReport ? reportTarget() : {}) })) as ApplyResult;
      setApplied(r);
      toast({
        title: t("runToast.import", { inserted: r.inserted, updated: r.updated }),
        description: r.errors ? t("runToast.detailErrors", { conflicts: r.conflicts, skipped: r.skipped, errors: r.errors }) : t("runToast.detail", { conflicts: r.conflicts, skipped: r.skipped }),
        variant: r.errors ? "destructive" : undefined,
      });
    } catch (e) {
      toast({ title: t("import.failed"), description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) pick(f);
  };

  const writable = preview && (preview.counts.insert + preview.counts.update + preview.counts.adopt + preview.counts.conflict) > 0;

  return (
    <Panel title={t("import.title")} description={t("import.description")} icon={FileUp}>
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
          aria-label={t("import.dropAria")}
        >
          <Upload className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          {file ? (
            <div className="flex min-w-0 max-w-full items-center gap-2 text-sm">
              <span className="min-w-0 truncate font-medium" title={file.name}>{file.name}</span>
              <span className="shrink-0 text-muted-foreground">{t("import.size", { size: fmtCount(Math.round(file.size / 1024)) })}</span>
              <button type="button" className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-[var(--glass-bg)] hover:text-foreground" onClick={(e) => { e.stopPropagation(); pick(null); }} aria-label={t("import.removeFile")}><X className="h-4 w-4" aria-hidden="true" /></button>
            </div>
          ) : (
            <>
              <div className="text-sm">{t("import.dropHint")}</div>
              <div className="text-xs text-muted-foreground">{t("import.dropFormats")}</div>
            </>
          )}
          <input ref={inputRef} type="file" accept=".csv,.txt,.xls,.xlsx" className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">{t("import.format")}</Label>
            <Select value={kind} onValueChange={(v) => { setKind(v as Kind); setPreview(null); }}>
              <SelectTrigger className="w-56" aria-label={t("import.format")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t("import.kind.auto")}</SelectItem>
                <SelectItem value="fills">{t("import.kind.fills")}</SelectItem>
                <SelectItem value="trades">{t("import.kind.trades")}</SelectItem>
                <SelectItem value="performance">{t("import.kind.performance")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {isReport && staff && (
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">{t("import.trader")}</Label>
              <PersonSelect value={reportTrader} onValueChange={(v) => { setReportTrader(v); setPreview(null); }} options={(users.data ?? []).filter((u) => u.active).map((u) => u.name)} placeholder={t("import.pickTrader")} ariaLabel={t("import.trader")} className="w-60" />
            </div>
          )}
          {isReport && !staff && (
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">{t("import.account")}</Label>
              <Select value={account} onValueChange={(v) => { setAccount(v); setPreview(null); }}>
                <SelectTrigger className="w-60" aria-label={t("import.account")}><SelectValue placeholder={t("import.pickAccount")} /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => <SelectItem key={a.id} value={a.account}>{a.trader ? `${a.account} — ${personName(a.trader)}` : t("import.accountUnmapped", { account: a.account })}</SelectItem>)}
                  {!accounts.length && <SelectItem value="__none" disabled>{t("import.addAccountFirst")}</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button variant="outline" onClick={runPreview} disabled={!file || needAccount || importFile.isPending}>
            {importFile.isPending && importFile.variables?.dryRun ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
            {t("import.preview")}
          </Button>
          {!perf && (
            <Button
              onClick={runApply}
              disabled={!preview || !writable || importFile.isPending || !!applied}
              title={!preview ? t("import.needPreview") : !writable && !applied ? t("import.nothingTitle") : undefined}
            >
              {importFile.isPending && importFile.variables?.dryRun === false ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("import.run")}
            </Button>
          )}
          {!staff && <Pill tone="neutral">{t("import.onlyYours")}</Pill>}
        </div>
        {preview && !writable && !applied && !perf && (
          <p role="status" className="-mt-1 rounded-xl border border-[var(--glass-border)] px-3 py-2 text-sm text-muted-foreground">
            {t("import.nothingToImport", { count: preview.counts.unchanged ?? 0 })}
          </p>
        )}
        {isReport && staff && fileAccount && (
          <p className="-mt-2 text-xs text-muted-foreground">{t(fileOwner ? "import.fileAccount" : "import.fileAccountLink", { account: fileAccount })}</p>
        )}

        {applied && (
          <div className="rounded-xl border border-[var(--glass-border)] p-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Pill tone="up">{t("counts.inserted", { count: applied.inserted })}</Pill>
              <Pill tone="accent">{t("counts.updated", { count: applied.updated })}</Pill>
              <Pill tone="neutral">{t("counts.unchanged", { count: applied.unchanged })}</Pill>
              {applied.conflicts > 0 && <Pill tone="warn">{t("counts.conflicts", { count: applied.conflicts })}</Pill>}
              {applied.skipped > 0 && <Pill tone="neutral">{t("counts.skipped", { count: applied.skipped })}</Pill>}
              {applied.errors > 0 && <Pill tone="down">{t("counts.errors", { count: applied.errors })}</Pill>}
            </div>
            {applied.errorText && <pre className="mt-2 whitespace-pre-wrap text-xs text-down">{applied.errorText}</pre>}
            <div className="mt-2"><NextSteps result={applied} onGoTab={onGoTab} /></div>
          </div>
        )}

        {perf && (
          <div className="grid gap-3 rounded-xl border border-[var(--glass-border)] p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Pill tone="purple">Trade Performance</Pill>
              <span>{t("import.perfAccount")} <b>{perf.account}</b></span>
              <span className="text-muted-foreground">{perf.periodFrom} — {perf.periodTo}</span>
              <Pill tone="neutral">{commonI18n.t("units.tickers", { count: perf.symbols })}</Pill>
              {perf.traderSource && perf.traderSource !== "manual" && <Pill tone="accent">{t("import.traderByMapping")}</Pill>}
              {perf.dryRun === false && <Pill tone="up">{perf.replaced ? t("import.replacedTag", { id: perf.reportId ?? "" }) : t("import.savedTag", { id: perf.reportId ?? "" })}</Pill>}
            </div>
            <p className="text-xs text-muted-foreground">{perf.note}</p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="grid gap-1">
                <Label className="text-xs text-muted-foreground">{t("import.trader")}</Label>
                {staff ? (
                  <PersonSelect value={perfTrader} onValueChange={setPerfTrader} options={(users.data ?? []).filter((u) => u.active).map((u) => u.name)} placeholder={t("import.pickTrader")} ariaLabel={t("import.trader")} className="w-56" />
                ) : (
                  <div className="text-sm font-medium">{personName(perfTrader || viewerName)}</div>
                )}
              </div>
              <Button onClick={runApplyPerformance} disabled={!perfTrader || importFile.isPending || perf.dryRun === false}>
                {importFile.isPending && importFile.variables?.dryRun === false ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {perf.dryRun === false ? t("import.saved") : t("import.importStats")}
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
