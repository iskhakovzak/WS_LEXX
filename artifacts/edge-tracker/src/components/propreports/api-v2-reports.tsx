/**
 * «API» tab, part 1 (staff): any PropReports report for a period — preview the first rows or download the CSV — and
 * the locates list. The report form only shows what the chosen type takes: an account for account reports, the
 * documented modes, a base currency for multi-currency types. Dates are prefilled with the last 7 days.
 */
import * as React from "react";
import { Download, Eye, FileSpreadsheet, Loader2, ScrollText } from "lucide-react";
import { DataTable, EmptyState, ErrorState, Panel, Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { localDateString } from "@/lib/local-date";
import { propreportsI18n } from "@/i18n/ns/propreports";
import type { AccountMapping } from "./api";
import { downloadReport, useLocates, useReportPreview, useReportTypes, type ReportQuery } from "./api-v2-api";

const ALL = "__all__";
const DEFAULT_MODE = "__default__";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDateString(d);
}

/** Readable label of a documented `mode` value (totals* vs performance* families). */
function modeLabel(type: string, mode: string): string {
  const family = type.startsWith("totals") ? "modeTotals" : "modePerformance";
  return propreportsI18n.tryT(`apiV2.reports.${family}.${mode}`) ?? mode;
}

function DateRange({ id, from, to, onFrom, onTo }: { id: string; from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  const { t } = propreportsI18n.useT();
  return (
    <>
      <div className="grid gap-1"><Label htmlFor={`${id}-from`} className="text-xs text-muted-foreground">{t("apiV2.reports.from")}</Label><Input id={`${id}-from`} type="date" value={from} max={to} onChange={(e) => onFrom(e.target.value)} className="h-9 w-40" /></div>
      <div className="grid gap-1"><Label htmlFor={`${id}-to`} className="text-xs text-muted-foreground">{t("apiV2.reports.to")}</Label><Input id={`${id}-to`} type="date" value={to} min={from} onChange={(e) => onTo(e.target.value)} className="h-9 w-40" /></div>
    </>
  );
}

/** Broker accounts with a PropReports id (from the mapping), as select options. */
function AccountSelect({ id, accounts, value, onChange, allowAll }: { id: string; accounts: AccountMapping[]; value: string; onChange: (v: string) => void; allowAll: boolean }) {
  const { t } = propreportsI18n.useT();
  const withId = accounts.filter((a) => a.accountId);
  if (!withId.length) {
    return <Input id={id} value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" className="h-9 w-40" />;
  }
  return (
    <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
      <SelectTrigger id={id} className="h-9 w-56"><SelectValue placeholder={t("apiV2.reports.accountId")} /></SelectTrigger>
      <SelectContent>
        {allowAll && <SelectItem value={ALL}>{t("apiV2.reports.groupHint")}</SelectItem>}
        {withId.map((a) => <SelectItem key={a.id} value={a.accountId!}>{a.account}{a.trader ? ` · ${a.trader}` : ""}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function ReportPreviewTable({ q }: { q: ReportQuery }) {
  const { t } = propreportsI18n.useT();
  const preview = useReportPreview(q);
  if (preview.isLoading) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />;
  if (preview.error) return <ErrorState compact error={preview.error} title={t("apiV2.reports.failed")} onRetry={() => preview.refetch()} />;
  const d = preview.data;
  if (!d) return null;
  if (!d.totalRows) return <p className="text-sm text-muted-foreground">{t("apiV2.reports.empty")}</p>;
  return (
    <div className="space-y-1">
      <DataTable maxHeight="60vh" ariaLabel={q.type}>
        <table>
          <thead><tr>{d.header.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
          <tbody>{d.rows.map((r, i) => <tr key={i}>{d.header.map((_, j) => <td key={j} className="whitespace-nowrap">{r[j] ?? ""}</td>)}</tr>)}</tbody>
        </table>
      </DataTable>
      <p className="text-xs text-muted-foreground">{t("apiV2.reports.rows", { shown: d.rows.length, total: d.totalRows })}</p>
    </div>
  );
}

export function ReportsPanel({ accounts }: { accounts: AccountMapping[] }) {
  const { t } = propreportsI18n.useT();
  const { toast } = useToast();
  const types = useReportTypes();
  const [type, setType] = React.useState("");
  const [from, setFrom] = React.useState(() => daysAgo(7));
  const [to, setTo] = React.useState(() => localDateString());
  const [accountId, setAccountId] = React.useState("");
  const [mode, setMode] = React.useState("");
  const [baseCurrency, setBaseCurrency] = React.useState("");
  const [shown, setShown] = React.useState<ReportQuery | null>(null);
  const [downloading, setDownloading] = React.useState(false);
  const info = types.data?.reports.find((r) => r.type === type) ?? null;
  const modes = (type && types.data?.modes[type]) || [];
  const needsAccount = info?.scope === "account" && !accountId;
  const valid = !!info && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to && !needsAccount && (!baseCurrency || /^[A-Za-z]{3}$/.test(baseCurrency));
  const query = (): ReportQuery => ({
    type, from, to,
    accountId: info?.scope === "account" ? accountId : undefined,
    mode: mode || undefined,
    baseCurrency: info?.multiCurrency && baseCurrency ? baseCurrency.toUpperCase() : undefined,
  });
  const onType = (v: string) => { setType(v); setMode(""); setShown(null); };
  const onDownload = async () => {
    setDownloading(true);
    try { await downloadReport(query()); } catch (e) {
      toast({ title: t("apiV2.reports.failed"), description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setDownloading(false); }
  };

  return (
    <Panel title={t("apiV2.reports.title")} description={t("apiV2.reports.description")} icon={FileSpreadsheet}>
      {types.error ? (
        <ErrorState compact error={types.error} title={t("apiV2.reports.listFailed")} onRetry={() => types.refetch()} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1">
              <Label htmlFor="pr-rep-type" className="text-xs text-muted-foreground">{t("apiV2.reports.type")}</Label>
              <Select value={type} onValueChange={onType} disabled={types.isLoading}>
                <SelectTrigger id="pr-rep-type" className="h-9 w-72"><SelectValue placeholder={t("apiV2.reports.typePlaceholder")} /></SelectTrigger>
                <SelectContent>
                  {(types.data?.reports ?? []).map((r) => <SelectItem key={r.type} value={r.type}>{r.description || r.type}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <DateRange id="pr-rep" from={from} to={to} onFrom={(v) => { setFrom(v); setShown(null); }} onTo={(v) => { setTo(v); setShown(null); }} />
            {info?.scope === "account" && (
              <div className="grid gap-1">
                <Label htmlFor="pr-rep-acc" className="text-xs text-muted-foreground">{t("apiV2.reports.accountId")}</Label>
                <AccountSelect id="pr-rep-acc" accounts={accounts} value={accountId} onChange={(v) => { setAccountId(v); setShown(null); }} allowAll={false} />
              </div>
            )}
            {modes.length > 0 && (
              <div className="grid gap-1">
                <Label htmlFor="pr-rep-mode" className="text-xs text-muted-foreground">{t("apiV2.reports.mode")}</Label>
                <Select value={mode || DEFAULT_MODE} onValueChange={(v) => { setMode(v === DEFAULT_MODE ? "" : v); setShown(null); }}>
                  <SelectTrigger id="pr-rep-mode" className="h-9 w-64"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_MODE}>{t("apiV2.reports.modeDefault")}</SelectItem>
                    {modes.map((m) => <SelectItem key={m} value={m}>{modeLabel(type, m)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {info?.multiCurrency && (
              <div className="grid gap-1">
                <Label htmlFor="pr-rep-cur" className="text-xs text-muted-foreground">{t("apiV2.reports.baseCurrency")}</Label>
                <Input id="pr-rep-cur" value={baseCurrency} maxLength={3} placeholder="USD" onChange={(e) => { setBaseCurrency(e.target.value.toUpperCase()); setShown(null); }} className="h-9 w-24 uppercase" />
              </div>
            )}
          </div>
          {info && (
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Pill tone="neutral">{info.scope === "group" ? t("apiV2.reports.scopeGroup") : t("apiV2.reports.scopeAccount")}</Pill>
              {info.multiCurrency && <Pill tone="accent">{t("apiV2.reports.multiCurrency")}</Pill>}
              {info.scope === "group" ? t("apiV2.reports.groupHint") : needsAccount ? t("apiV2.reports.accountHint") : null}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setShown(query())} disabled={!valid}>
              <Eye className="mr-2 h-4 w-4" aria-hidden="true" />{t("apiV2.reports.preview")}
            </Button>
            <Button onClick={onDownload} disabled={!valid || downloading}>
              {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Download className="mr-2 h-4 w-4" aria-hidden="true" />}
              {t("apiV2.reports.download")}
            </Button>
          </div>
          {shown && <ReportPreviewTable q={shown} />}
        </div>
      )}
    </Panel>
  );
}

export function LocatesPanel({ accounts }: { accounts: AccountMapping[] }) {
  const { t } = propreportsI18n.useT();
  const [from, setFrom] = React.useState(() => daysAgo(7));
  const [to, setTo] = React.useState(() => localDateString());
  const [accountId, setAccountId] = React.useState("");
  const [q, setQ] = React.useState<{ from: string; to: string; accountId?: string; page: number } | null>(null);
  const locates = useLocates(q);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
  const page = locates.data?.page;
  const rows = locates.data?.locates ?? [];

  return (
    <Panel title={t("apiV2.locates.title")} description={t("apiV2.locates.description")} icon={ScrollText}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <DateRange id="pr-loc" from={from} to={to} onFrom={setFrom} onTo={setTo} />
          <div className="grid gap-1">
            <Label htmlFor="pr-loc-acc" className="text-xs text-muted-foreground">{t("apiV2.reports.accountId")}</Label>
            <AccountSelect id="pr-loc-acc" accounts={accounts} value={accountId} onChange={setAccountId} allowAll />
          </div>
          <Button variant="outline" onClick={() => setQ({ from, to, accountId: accountId || undefined, page: 1 })} disabled={!valid}>
            <Eye className="mr-2 h-4 w-4" aria-hidden="true" />{t("apiV2.locates.show")}
          </Button>
        </div>
        {!q ? null : locates.isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />
        ) : locates.error ? (
          <ErrorState compact error={locates.error} title={t("apiV2.locates.failed")} onRetry={() => locates.refetch()} />
        ) : !rows.length ? (
          <EmptyState icon={ScrollText} title={t("apiV2.locates.empty")} />
        ) : (
          <div className="space-y-2">
            <DataTable maxHeight="60vh" ariaLabel={t("apiV2.locates.title")}>
              <table>
                <thead>
                  <tr>
                    <th>{t("apiV2.locates.col.dateTime")}</th><th>{t("apiV2.locates.col.account")}</th>
                    <th className="text-right">{t("apiV2.locates.col.qty")}</th><th>{t("apiV2.locates.col.symbol")}</th>
                    <th className="text-right">{t("apiV2.locates.col.cost")}</th><th>{t("apiV2.locates.col.locateId")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l, i) => (
                    <tr key={`${l.locateId ?? ""}-${i}`}>
                      <td className="whitespace-nowrap">{l.dateTime}</td>
                      <td>{l.account}{l.accountName ? <span className="text-muted-foreground"> · {l.accountName}</span> : null}</td>
                      <td className="text-right">{l.qty}</td><td className="font-medium">{l.symbol}</td>
                      <td className="text-right">{l.cost.toFixed(2)}</td><td className="text-xs text-muted-foreground">{l.locateId ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTable>
            {page && page.total > 1 && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Button size="sm" variant="outline" disabled={page.current <= 1} onClick={() => setQ((x) => x && { ...x, page: x.page - 1 })}>{t("apiV2.locates.prev")}</Button>
                {t("apiV2.locates.page", { current: page.current, total: page.total })}
                <Button size="sm" variant="outline" disabled={page.current >= page.total} onClick={() => setQ((x) => x && { ...x, page: x.page + 1 })}>{t("apiV2.locates.next")}</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
