/**
 * «Случаи из рынка» of a setup (api /playbook/:id/cases, migration 0286): a ticker + a day when the setup worked, with
 * an optional entry / exit time, side and note — not necessarily our trade. The chart is the chart engine's own
 * (WsChart) built from the candle archive / market data of that day; every case has «Похожие прошлые случаи». The
 * add form asks for two things (ticker, date — the last session pre-filled); time, side and note open on demand.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CandlestickChart, Plus, Trash2 } from "lucide-react";
import { EmptyState, ErrorState, ListSkeleton, Panel } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WsChart, etWallToEpoch, type TradeLike } from "@/components/chart-engine";
import { AnaloguesButton } from "@/components/shared/analogues/analogues-sheet";
import { casesQuery, useCaseMutations, type PlaybookCase } from "@/components/shared/analogues/api";
import { useToast } from "@/hooks/use-toast";
import { humanizeApiError } from "@/lib/api/errors";
import { fmtDate } from "@/lib/format";
import { nyDate, prevWeekday } from "@/lib/trading-date";
import { personName } from "@/i18n";
import { analoguesI18n } from "@/i18n/ns/analogues";

const isoAt = (day: string, hhmm: string | null) => {
  const m = hhmm ? /^(\d{2}):(\d{2})$/.exec(hhmm) : null;
  return m ? new Date(etWallToEpoch(day, Number(m[1]), Number(m[2])) * 1000).toISOString() : null;
};

/** The case as the chart engine's trade shape: no id (nothing to fetch), no prices — just the day and the times. */
const asTrade = (c: PlaybookCase): TradeLike => ({ id: -c.id, ticker: c.ticker, date: c.day, side: c.side, entryTime: isoAt(c.day, c.entryTime), exitTime: isoAt(c.day, c.exitTime) });

function CaseRow({ c, setupId, canRemove }: { c: PlaybookCase; setupId: number; canRemove: boolean }) {
  const { t } = analoguesI18n.useT();
  const { toast } = useToast();
  const [chart, setChart] = React.useState(false);
  const mut = useCaseMutations(setupId);
  const trade = React.useMemo(() => asTrade(c), [c]);
  return (
    <li className="rounded-xl border border-[var(--glass-border)] p-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-semibold text-foreground">{c.ticker}</span>
        <span className="text-muted-foreground">{fmtDate(c.day, "medium")}</span>
        {c.side && <span className="text-xs text-muted-foreground">{t(`cases.${c.side}`)}</span>}
        {(c.entryTime || c.exitTime) && <span className="text-xs text-muted-foreground">{c.entryTime ?? "—"} → {c.exitTime ?? "—"} NY</span>}
        <span className="text-xs text-muted-foreground">· {t("cases.by", { name: personName(c.addedBy) })}</span>
        <span className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-7" onClick={() => setChart((v) => !v)} aria-expanded={chart}>
            <CandlestickChart aria-hidden="true" />{chart ? t("cases.hideChart") : t("cases.chart")}
          </Button>
          <AnaloguesButton ticker={c.ticker} day={c.day} setupId={setupId} short />
          {canRemove && (
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t("cases.remove")} disabled={mut.remove.isPending}
              onClick={() => mut.remove.mutate(c.id, { onSuccess: () => toast({ title: t("cases.removed") }), onError: (e) => toast({ title: t("cases.saveFailed"), description: humanizeApiError(e), variant: "destructive" }) })}>
              <Trash2 aria-hidden="true" />
            </Button>
          )}
        </span>
      </div>
      {c.note && <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{c.note}</p>}
      {chart && <div className="mt-2"><WsChart trade={trade} executions={[]} initialTimeframe="5m" mode="analysis" showModes={false} height={360} contextDays={0} /></div>}
    </li>
  );
}

const blank = () => ({ ticker: "", day: prevWeekday(nyDate()), entryTime: "", exitTime: "", side: "" as "" | "long" | "short", note: "" });

function AddCase({ setupId, onDone }: { setupId: number; onDone: () => void }) {
  const { t } = analoguesI18n.useT();
  const { toast } = useToast();
  const mut = useCaseMutations(setupId);
  const [f, setF] = React.useState(blank);
  const [more, setMore] = React.useState(false);
  const set = <K extends keyof ReturnType<typeof blank>>(k: K, v: ReturnType<typeof blank>[K]) => setF((x) => ({ ...x, [k]: v }));
  const valid = /^[A-Za-z0-9][-A-Za-z0-9.]{0,11}$/.test(f.ticker.trim()) && /^\d{4}-\d{2}-\d{2}$/.test(f.day);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    mut.add.mutate(
      { ticker: f.ticker.trim().toUpperCase(), day: f.day, entryTime: f.entryTime || null, exitTime: f.exitTime || null, side: f.side || null, note: f.note.trim() || null },
      {
        onSuccess: () => { toast({ title: t("cases.saved") }); setF(blank()); onDone(); },
        onError: (err) => toast({ title: t("cases.saveFailed"), description: humanizeApiError(err), variant: "destructive" }),
      },
    );
  };
  return (
    <form onSubmit={submit} className="mb-3 flex flex-col gap-2 rounded-xl border border-dashed border-border p-2.5">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="case-ticker">{t("cases.ticker")}</Label>
          <Input id="case-ticker" className="h-9 w-28 uppercase" value={f.ticker} maxLength={12} autoFocus onChange={(e) => set("ticker", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="case-day">{t("cases.day")}</Label>
          <Input id="case-day" type="date" className="h-9 w-40" value={f.day} max={nyDate()} onChange={(e) => set("day", e.target.value)} />
        </div>
        {!more && <Button type="button" variant="ghost" size="sm" onClick={() => setMore(true)}>{t("cases.more")}</Button>}
        <Button type="submit" size="sm" disabled={!valid || mut.add.isPending}>{t("cases.save")}</Button>
      </div>
      {more && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="case-entry">{t("cases.entry")}</Label>
            <Input id="case-entry" type="time" className="h-9 w-28" value={f.entryTime} onChange={(e) => set("entryTime", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="case-exit">{t("cases.exit")}</Label>
            <Input id="case-exit" type="time" className="h-9 w-28" value={f.exitTime} onChange={(e) => set("exitTime", e.target.value)} />
          </div>
          <div className="flex items-center gap-1" role="group" aria-label={t("cases.side")}>
            {(["long", "short"] as const).map((s) => (
              <button key={s} type="button" aria-pressed={f.side === s} onClick={() => set("side", f.side === s ? "" : s)} className="chip inline-flex h-9 items-center px-3 text-xs font-medium">
                {t(`cases.${s}`)}
              </button>
            ))}
          </div>
          <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
            <Label htmlFor="case-note">{t("cases.note")}</Label>
            <Input id="case-note" className="h-9" value={f.note} maxLength={2000} onChange={(e) => set("note", e.target.value)} />
          </div>
        </div>
      )}
    </form>
  );
}

export function PlaybookCasesSection({ setupId, canEdit, viewerName }: { setupId: number; canEdit: boolean; viewerName: string | null }) {
  const { t } = analoguesI18n.useT();
  const q = useQuery(casesQuery(setupId));
  const [adding, setAdding] = React.useState(false);
  const canAdd = !!q.data?.canAdd;
  const list = q.data?.cases ?? [];
  return (
    <Panel
      icon={CandlestickChart}
      title={t("cases.title")}
      description={t("cases.description")}
      actions={canAdd && !adding ? <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus aria-hidden="true" />{t("cases.add")}</Button> : undefined}
    >
      {adding && <AddCase setupId={setupId} onDone={() => setAdding(false)} />}
      {q.isLoading ? <ListSkeleton rows={2} dense /> : q.isError ? (
        <ErrorState compact error={q.error} onRetry={q.refetch} title={t("cases.loadFailed")} />
      ) : !list.length ? (
        !adding && <EmptyState compact icon={CandlestickChart} title={t("cases.empty")} action={canAdd ? <Button size="sm" onClick={() => setAdding(true)}><Plus aria-hidden="true" />{t("cases.add")}</Button> : undefined} />
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((c) => <CaseRow key={c.id} c={c} setupId={setupId} canRemove={canEdit || (!!viewerName && c.addedBy === viewerName)} />)}
        </ul>
      )}
    </Panel>
  );
}
