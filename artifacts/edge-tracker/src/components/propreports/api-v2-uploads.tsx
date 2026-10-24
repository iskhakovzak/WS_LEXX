/**
 * «API» tab, part 2 (staff, superuser token only): send a file to PropReports (multipart upload), the recent uploads
 * (uploadSearch) and one upload's status + processing messages. PropReports has no "who am I": the server remembers
 * whether the token got a 403 on a superuser action. Unknown → one safe check button; not superuser → the tools are
 * hidden (one muted line to re-check after a token change); superuser → the tools.
 */
import * as React from "react";
import { Loader2, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import { DataTable, EmptyState, ErrorState, ListSkeleton, Panel, Pill, TableSkeleton, type Tone } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { propreportsI18n } from "@/i18n/ns/propreports";
import { agoText } from "./api";
import {
  isSuperuserRequired, isUploadRunning, useCheckSuperuser, useRefreshSuperuser, useSuperuser, useUploadFile, useUploadMessages, useUploadSearch, useUploadStatus,
  UPLOAD_SEARCH_STATUSES, UPLOAD_TYPES, type UploadSearchStatus, type UploadSummary, type UploadType,
} from "./api-v2-api";

const DEFAULT = "__default__";
const NONE = "__none__";

function statusTone(s: string): Tone {
  if (isUploadRunning(s)) return "accent";
  if (/^(uploaded|reconciled)$/i.test(s)) return "up";
  if (/^aborted|^deleted/i.test(s)) return "down";
  return "neutral";
}

function statusLabel(s: string): string {
  const key = s.replace(/\s+(\w)/g, (_, c: string) => c.toUpperCase()).replace(/^\w/, (c) => c.toLowerCase());
  return propreportsI18n.tryT(`apiV2.su.search.statuses.${key}`) ?? s;
}

function UploadForm({ onSent }: { onSent: (id: string) => void }) {
  const { t } = propreportsI18n.useT();
  const { toast } = useToast();
  const upload = useUploadFile();
  const [file, setFile] = React.useState<File | null>(null);
  const [type, setType] = React.useState<UploadType>("fill");
  const [sourceId, setSourceId] = React.useState("");
  const [clearingFirmId, setClearingFirmId] = React.useState("");
  const [replacementKey, setReplacementKey] = React.useState("");
  const [processingMode, setProcessingMode] = React.useState<"" | "tradeFeeAdjustments">("");
  const [reconciliationMode, setReconciliationMode] = React.useState<"" | "account" | "clearing">("");
  const [force, setForce] = React.useState(false);
  const fill = type === "fill";
  const clearingMissing = fill && reconciliationMode === "clearing" && !clearingFirmId;
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || clearingMissing) return;
    try {
      const r = await upload.mutateAsync({
        file, type, sourceId, clearingFirmId, replacementKey,
        processingMode: fill ? processingMode : "", reconciliationMode: fill ? reconciliationMode : "", forceDuplicateProcessing: force || undefined,
      });
      const ids = r.uploads.map((u) => u.uploadId);
      toast({ title: t("apiV2.su.upload.sentTitle"), description: t("apiV2.su.upload.sentText", { ids: ids.join(", ") || "—" }) });
      setFile(null);
      if (ids[0]) onSent(ids[0]);
    } catch (err) {
      toast({ title: t("apiV2.su.upload.failed"), description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };
  const field = (id: string, label: string, value: string, set: (v: string) => void, numeric = false, hint?: string) => (
    <div className="grid gap-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      <Input id={id} value={value} onChange={(e) => set(numeric ? e.target.value.replace(/[^\d]/g, "") : e.target.value)} inputMode={numeric ? "numeric" : undefined} className="h-9 w-48" title={hint} />
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <h3 className="text-sm font-semibold">{t("apiV2.su.upload.title")}</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor="pr-up-file" className="text-xs text-muted-foreground">{t("apiV2.su.upload.file")}</Label>
          <Input id="pr-up-file" type="file" accept=".csv,.txt,.zip,.xls,.xlsx,.xml,.json,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="h-9 w-72" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="pr-up-type" className="text-xs text-muted-foreground">{t("apiV2.su.upload.type")}</Label>
          <Select value={type} onValueChange={(v) => setType(v as UploadType)}>
            <SelectTrigger id="pr-up-type" className="h-9 w-48"><SelectValue /></SelectTrigger>
            <SelectContent>{UPLOAD_TYPES.map((x) => <SelectItem key={x} value={x}>{t(`apiV2.su.upload.types.${x}`)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={!file || clearingMissing || upload.isPending}>
          {upload.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Upload className="mr-2 h-4 w-4" aria-hidden="true" />}
          {t("apiV2.su.upload.submit")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("apiV2.su.upload.zipHint")}</p>
      <details className="rounded-xl border border-[var(--glass-border)] p-3">
        <summary className="cursor-pointer text-sm">{t("apiV2.su.upload.advanced")}</summary>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          {field("pr-up-src", t("apiV2.su.upload.sourceId"), sourceId, setSourceId, true)}
          {field("pr-up-key", t("apiV2.su.upload.replacementKey"), replacementKey, setReplacementKey, false, t("apiV2.su.upload.replacementHint"))}
          {fill && (
            <div className="grid gap-1">
              <Label htmlFor="pr-up-proc" className="text-xs text-muted-foreground">{t("apiV2.su.upload.processingMode")}</Label>
              <Select value={processingMode || NONE} onValueChange={(v) => setProcessingMode(v === NONE ? "" : "tradeFeeAdjustments")}>
                <SelectTrigger id="pr-up-proc" className="h-9 w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("apiV2.su.upload.processingNone")}</SelectItem>
                  <SelectItem value="tradeFeeAdjustments">{t("apiV2.su.upload.processingFees")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {fill && (
            <div className="grid gap-1">
              <Label htmlFor="pr-up-rec" className="text-xs text-muted-foreground">{t("apiV2.su.upload.reconciliation")}</Label>
              <Select value={reconciliationMode || NONE} onValueChange={(v) => setReconciliationMode(v === NONE ? "" : (v as "account" | "clearing"))}>
                <SelectTrigger id="pr-up-rec" className="h-9 w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("apiV2.su.upload.reconNone")}</SelectItem>
                  <SelectItem value="account">{t("apiV2.su.upload.reconAccount")}</SelectItem>
                  <SelectItem value="clearing">{t("apiV2.su.upload.reconClearing")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {(fill && reconciliationMode === "clearing") && field("pr-up-clr", t("apiV2.su.upload.clearingFirmId"), clearingFirmId, setClearingFirmId, true)}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={force} onCheckedChange={(v) => setForce(v === true)} />{t("apiV2.su.upload.force")}
          </label>
        </div>
        {clearingMissing && <p className="mt-2 text-xs text-down">{t("apiV2.su.upload.clearingNeedsFirm")}</p>}
      </details>
    </form>
  );
}

function UploadDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t } = propreportsI18n.useT();
  const status = useUploadStatus(id);
  const messages = useUploadMessages(id);
  const s = status.data?.summaries[0] ?? null;
  return (
    <Dialog open={!!id} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-[min(96vw,56rem)]">
        <DialogHeader><DialogTitle>{t("apiV2.su.status.title", { id: id ?? "" })}</DialogTitle></DialogHeader>
        {status.error ? <ErrorState compact error={status.error} onRetry={() => status.refetch()} /> : !s ? (
          <ListSkeleton rows={4} dense />
        ) : (
          <div className="space-y-4 text-sm">
            <p className="flex flex-wrap items-center gap-2">
              <Pill tone={statusTone(s.status)} dot>{statusLabel(s.status)}</Pill>
              <span>{s.fileName ?? "—"}</span>
              <span className="text-muted-foreground">{s.dateTime ?? ""}{s.parser ? ` · ${s.parser}` : ""}</span>
              {isUploadRunning(s.status) && <span className="text-xs text-muted-foreground">{t("apiV2.su.status.running")}</span>}
            </p>
            {s.comment && <p className="text-muted-foreground">{s.comment}</p>}
            {!!status.data?.details.length && (
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">{t("apiV2.su.status.details")}</h3>
                <DataTable ariaLabel={t("apiV2.su.status.details")}>
                  <table>
                    <thead><tr><th>{t("apiV2.su.status.col.date")}</th><th>{t("apiV2.su.status.col.dataType")}</th><th className="text-right">{t("apiV2.su.status.col.entries")}</th><th>{t("apiV2.su.status.col.status")}</th></tr></thead>
                    <tbody>{status.data.details.map((d, i) => <tr key={i}><td>{d.date}</td><td>{d.dataType}</td><td className="text-right">{d.entries ?? "—"}</td><td>{d.deletedOn ? <Pill tone="down">{d.status}</Pill> : statusLabel(d.status)}</td></tr>)}</tbody>
                  </table>
                </DataTable>
              </div>
            )}
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">{t("apiV2.su.status.messages")}</h3>
              {messages.isLoading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : messages.data && !messages.data.empty ? (
                messages.data.sections.map((m, i) => (
                  <div key={i}>{m.title && <p className="text-xs font-medium">{m.title}</p>}<pre className="whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-2 text-xs">{m.body}</pre></div>
                ))
              ) : <p className="text-xs text-muted-foreground">{t("apiV2.su.status.messagesEmpty")}</p>}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function UploadList({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = propreportsI18n.useT();
  const [status, setStatus] = React.useState<UploadSearchStatus | "">("");
  const [replacementKey, setReplacementKey] = React.useState("");
  const [uploadDate, setUploadDate] = React.useState("");
  const q = { status: status ? [status] : undefined, replacementKey: replacementKey.trim() || undefined, uploadDate: uploadDate || undefined, page: 1 };
  const list = useUploadSearch(q);
  const refreshSuperuser = useRefreshSuperuser();
  const forbidden = isSuperuserRequired(list.error);
  React.useEffect(() => { if (forbidden) void refreshSuperuser(); }, [forbidden, refreshSuperuser]);
  const rows: UploadSummary[] = list.data?.uploads ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("apiV2.su.search.title")}</h3>
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <Label htmlFor="pr-us-status" className="text-xs text-muted-foreground">{t("apiV2.su.search.status")}</Label>
            <Select value={status || DEFAULT} onValueChange={(v) => setStatus(v === DEFAULT ? "" : (v as UploadSearchStatus))}>
              <SelectTrigger id="pr-us-status" className="h-9 w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT}>{t("apiV2.su.search.statusDefault")}</SelectItem>
                {UPLOAD_SEARCH_STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`apiV2.su.search.statuses.${s}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1"><Label htmlFor="pr-us-key" className="text-xs text-muted-foreground">{t("apiV2.su.search.replacementKey")}</Label><Input id="pr-us-key" value={replacementKey} onChange={(e) => setReplacementKey(e.target.value)} className="h-9 w-44" /></div>
          <div className="grid gap-1"><Label htmlFor="pr-us-date" className="text-xs text-muted-foreground">{t("apiV2.su.search.uploadDate")}</Label><Input id="pr-us-date" type="date" value={uploadDate} onChange={(e) => setUploadDate(e.target.value)} className="h-9 w-40" /></div>
          <Button size="icon" variant="outline" onClick={() => list.refetch()} aria-label={t("apiV2.su.search.title")} disabled={list.isFetching}>
            <RefreshCw className={`h-4 w-4 ${list.isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
          </Button>
        </div>
      </div>
      {list.isLoading ? <TableSkeleton rows={5} cols={6} /> : list.error ? (
        <ErrorState compact error={list.error} title={t("apiV2.su.search.failed")} onRetry={() => list.refetch()} />
      ) : !rows.length ? <EmptyState icon={Upload} title={t("apiV2.su.search.empty")} /> : (
        <DataTable maxHeight="50vh" ariaLabel={t("apiV2.su.search.title")}>
          <table>
            <thead><tr><th>{t("apiV2.su.search.col.id")}</th><th>{t("apiV2.su.search.col.when")}</th><th>{t("apiV2.su.search.col.file")}</th><th>{t("apiV2.su.search.col.source")}</th><th>{t("apiV2.su.search.col.status")}</th><th>{t("apiV2.su.search.col.comment")}</th><th /></tr></thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.uploadId}>
                  <td className="font-medium">{u.uploadId}</td>
                  <td className="whitespace-nowrap text-xs">{u.dateTime ?? "—"}</td>
                  <td className="max-w-[14rem] truncate" title={u.fileName ?? undefined}>{u.fileName ?? "—"}{u.replacementKey ? <span className="block text-2xs text-muted-foreground">{u.replacementKey}</span> : null}</td>
                  <td className="text-xs">{u.source ?? "—"}</td>
                  <td>
                    <span className="flex flex-wrap items-center gap-1">
                      <Pill tone={statusTone(u.status)} dot>{statusLabel(u.status)}</Pill>
                      {u.hasErrors && <Pill tone="down">{t("apiV2.su.search.errors")}</Pill>}
                      {u.hasNotes && <Pill tone="neutral">{t("apiV2.su.search.notes")}</Pill>}
                    </span>
                  </td>
                  <td className="max-w-[16rem] truncate text-xs text-muted-foreground" title={u.comment ?? undefined}>{u.comment ?? ""}</td>
                  <td><Button size="sm" variant="ghost" onClick={() => onOpen(u.uploadId)}>{t("apiV2.su.search.open")}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      )}
    </div>
  );
}

export function SuperuserUploads({ canSync }: { canSync: boolean }) {
  const { t } = propreportsI18n.useT();
  const state = useSuperuser();
  const check = useCheckSuperuser();
  const [open, setOpen] = React.useState<string | null>(null);
  const su = state.data?.superuser ?? null;
  const checkButton = (label: string) => (
    <Button size="sm" variant="outline" onClick={() => check.mutate()} disabled={check.isPending}>
      {check.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ShieldCheck className="mr-1.5 h-4 w-4" aria-hidden="true" />}
      {label}
    </Button>
  );
  if (state.isLoading || state.error) return null;
  if (su === false) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {t("apiV2.su.notSuperuser")}
        {state.data?.checkedAt ? <span>{t("apiV2.su.checkedAt", { ago: agoText(state.data.checkedAt) })}</span> : null}
        {checkButton(t("apiV2.su.recheck"))}
      </p>
    );
  }
  return (
    <Panel title={t("apiV2.su.title")} description={t("apiV2.su.description")} icon={Upload}>
      {su === null ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          {t("apiV2.su.unknown")}
          {checkButton(t("apiV2.su.check"))}
          {check.error ? <span className="text-down">{check.error instanceof Error ? check.error.message : String(check.error)}</span> : null}
        </div>
      ) : (
        <div className="space-y-section">
          {canSync && <UploadForm onSent={setOpen} />}
          <UploadList onOpen={setOpen} />
        </div>
      )}
      <UploadDialog id={open} onClose={() => setOpen(null)} />
    </Panel>
  );
}
