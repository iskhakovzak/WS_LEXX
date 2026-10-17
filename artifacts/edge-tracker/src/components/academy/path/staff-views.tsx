/** Mentor views of «Путь трейдера»: funnel by stage, request queue, criteria editor. */
import * as React from "react";
import { Filter, Inbox, Plus, Save, Settings2, Trash2 } from "lucide-react";
import { EmptyState, Panel, Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  type Criterion, type PathConfig, type StageKey, OP_LABEL, OPS,
  fmtInstant, sendJson, stageName, usd, useFunnel, usePathMutation, useRequests,
} from "./api";
import { StageLadder, selectCls } from "./bits";
import { PendingRequest } from "./person-view";

// ─── funnel ─────────────────────────────────────────────────────────────────

export function FunnelView({ onOpen }: { onOpen: (user: string) => void }) {
  const q = useFunnel(true);
  if (q.isLoading) return <Skeleton className="h-80 rounded-2xl" />;
  if (q.isError || !q.data) return <Panel><EmptyState icon={Filter} title="Воронка недоступна" description={(q.error as Error | null)?.message} /></Panel>;
  const f = q.data;
  const counts = Object.fromEntries(f.columns.map((c) => [c.key, c.people.length])) as Partial<Record<StageKey, number>>;
  return (
    <div className="flex flex-col gap-4">
      <StageLadder stages={f.stages} current={null} counts={counts} />
      <p className="text-sm text-muted-foreground" role="status">
        В воронке {f.totals.people} чел. · готовы к переводу <span className="font-semibold text-up">{f.totals.ready}</span> · заявок на рассмотрении {f.totals.pending}
      </p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {f.columns.map((col) => (
          <Panel key={col.key} title={col.name} description={`${col.people.length} чел.`} bodyClassName="flex flex-col gap-2">
            {col.people.length === 0 && <p className="text-xs text-muted-foreground">Пусто</p>}
            {col.people.map((p) => {
              const pct = p.total ? p.passed / p.total : 0;
              return (
                <button
                  key={p.user}
                  type="button"
                  onClick={() => onOpen(p.user)}
                  className={cn("flex flex-col gap-1.5 rounded-xl border p-2.5 text-left transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    p.ready ? "border-up/50" : "border-[var(--field-border)]")}
                  aria-label={`${p.user}: ${p.headline}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{p.user}</span>
                    {p.pendingRequestId ? <Pill tone="accent">заявка</Pill> : p.ready ? <Pill tone="up">готов</Pill> : null}
                  </div>
                  {p.stage && (
                    <>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--glass-bg)]" aria-hidden="true">
                        <div className={cn("h-full rounded-full", p.ready ? "bg-up" : pct >= 0.7 ? "bg-[hsl(var(--chart-3))]" : "bg-primary")} style={{ width: `${pct * 100}%` }} />
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground">{p.passed} из {p.total} · P&amp;L {usd(p.summary.net)} за {p.summary.windowDays} дн.</span>
                      {p.failing.length > 0 && <span className="line-clamp-2 text-[11px] text-muted-foreground">Не хватает: {p.failing.join(", ")}</span>}
                    </>
                  )}
                  {!p.stage && <span className="text-xs text-muted-foreground">Назначьте ступень</span>}
                </button>
              );
            })}
          </Panel>
        ))}
      </div>
    </div>
  );
}

// ─── requests ───────────────────────────────────────────────────────────────

export function RequestsView({ config, me, onOpen }: { config: PathConfig | undefined; me: string | null; onOpen: (user: string) => void }) {
  const pending = useRequests("pending", true);
  const all = useRequests(null, true);
  const stages = config?.stages ?? [];
  if (pending.isLoading) return <Skeleton className="h-60 rounded-2xl" />;
  const decided = (all.data?.requests ?? []).filter((r) => r.status !== "pending").slice(0, 30);
  return (
    <div className="flex flex-col gap-4">
      {pending.data?.requests.length
        ? pending.data.requests.map((r) => (
          <div key={r.id} className="flex flex-col gap-1">
            <button type="button" className="self-start text-sm font-semibold text-primary hover:underline" onClick={() => onOpen(r.user)}>{r.user} — открыть отчёт</button>
            <PendingRequest req={r} canDecide={r.user !== me} isSelf={r.user === me} stages={stages} />
          </div>
        ))
        : <Panel><EmptyState icon={Inbox} title="Заявок на рассмотрении нет" description="Ученики подают заявку со своей страницы «Путь трейдера»; когда критерии выполнены, наставнику приходит уведомление." /></Panel>}
      {decided.length > 0 && (
        <Panel title="Решённые заявки">
          <ul className="flex flex-col gap-2 text-sm">
            {decided.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-2">
                <Pill tone={r.status === "approved" ? "up" : r.status === "rejected" ? "down" : "neutral"}>{r.status === "approved" ? "одобрена" : r.status === "rejected" ? "отклонена" : "отозвана"}</Pill>
                <span className="font-medium text-foreground">{r.user}: {stageName(stages, r.fromStage)} → {stageName(stages, r.toStage)}</span>
                <span className="text-xs text-muted-foreground">{r.decidedBy ?? ""} · {fmtInstant(r.decidedAt)}</span>
                {r.decisionComment && <span className="w-full text-xs text-muted-foreground">«{r.decisionComment}»</span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

// ─── criteria editor ────────────────────────────────────────────────────────

type Draft = Omit<Criterion, "id"> & { id?: number; _k: string };
let seq = 0;
const toDraft = (c: Criterion): Draft => ({ ...c, _k: `c${c.id}` });

export function CriteriaEditor({ config }: { config: PathConfig }) {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<Draft[]>(() => config.criteria.map(toDraft));
  React.useEffect(() => setRows(config.criteria.map(toDraft)), [config.criteria]);
  const save = usePathMutation((body: unknown) => sendJson<{ criteria: Criterion[] }>("/academy/path/criteria", "PUT", body));
  const metrics = config.meta.metrics;
  const from = config.stages.slice(0, -1);
  const upd = (k: string, patch: Partial<Draft>) => setRows((rs) => rs.map((r) => (r._k === k ? { ...r, ...patch } : r)));

  if (!config.canEdit) return <Panel><EmptyState icon={Settings2} title="Только для наставников" /></Panel>;

  return (
    <div className="flex flex-col gap-4">
      {from.map((st, i) => {
        const list = rows.filter((r) => r.fromStage === st.key);
        const to = config.stages[i + 1];
        return (
          <Panel key={st.key} title={`«${st.name}» → «${to?.name}»`} description={`${list.filter((r) => r.enabled).length} активных критериев. Окно — последние N торговых дней; пусто — с начала ступени.`}
            actions={<Button size="sm" variant="outline" onClick={() => setRows((rs) => [...rs, { _k: `n${++seq}`, fromStage: st.key, metric: "net_pnl", op: ">=", value: 0, windowDays: 20, label: null, enabled: true }])}><Plus className="mr-1 h-4 w-4" aria-hidden="true" />Критерий</Button>}>
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th scope="col" className="py-1 pr-2 font-medium">Вкл.</th>
                    <th scope="col" className="py-1 pr-2 font-medium">Метрика</th>
                    <th scope="col" className="py-1 pr-2 font-medium">Условие</th>
                    <th scope="col" className="py-1 pr-2 font-medium">Значение</th>
                    <th scope="col" className="py-1 pr-2 font-medium">Окно, дн.</th>
                    <th scope="col" className="py-1 pr-2 font-medium">Подпись (необяз.)</th>
                    <th scope="col" className="py-1 font-medium"><span className="sr-only">Удалить</span></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => {
                    const meta = metrics.find((m) => m.key === r.metric);
                    return (
                      <tr key={r._k} className="border-t border-[var(--field-border)]">
                        <td className="py-1.5 pr-2"><input type="checkbox" aria-label="Критерий включён" checked={r.enabled} onChange={(e) => upd(r._k, { enabled: e.target.checked })} className="h-4 w-4 accent-[hsl(var(--primary))]" /></td>
                        <td className="py-1.5 pr-2">
                          <select aria-label="Метрика" className={cn(selectCls, "w-full")} value={r.metric} title={meta?.hint} onChange={(e) => upd(r._k, { metric: e.target.value })}>
                            {metrics.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                          </select>
                        </td>
                        <td className="py-1.5 pr-2">
                          <select aria-label="Условие" className={selectCls} value={r.op} onChange={(e) => upd(r._k, { op: e.target.value as Criterion["op"] })}>
                            {OPS.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
                          </select>
                        </td>
                        <td className="py-1.5 pr-2"><input type="number" aria-label="Значение" className={cn(selectCls, "w-28 tabular-nums")} value={r.value} step="any" onChange={(e) => upd(r._k, { value: Number(e.target.value) })} /></td>
                        <td className="py-1.5 pr-2"><input type="number" aria-label="Окно в торговых днях" className={cn(selectCls, "w-24 tabular-nums")} value={r.windowDays ?? ""} min={1} max={260} placeholder="ступень" onChange={(e) => upd(r._k, { windowDays: e.target.value === "" ? null : Math.round(Number(e.target.value)) })} /></td>
                        <td className="py-1.5 pr-2"><input aria-label="Подпись" className={cn(selectCls, "w-full")} value={r.label ?? ""} maxLength={120} placeholder={meta?.label} onChange={(e) => upd(r._k, { label: e.target.value || null })} /></td>
                        <td className="py-1.5"><Button size="icon" variant="ghost" aria-label="Убрать критерий (архивируется)" onClick={() => setRows((rs) => rs.filter((x) => x._k !== r._k))}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={save.isPending}
          onClick={() => save.mutate(rows.map(({ _k, ...r }) => ({ ...r, value: Number.isFinite(r.value) ? r.value : 0 })), {
            onSuccess: () => toast({ title: "Критерии сохранены", description: "Убранные критерии архивированы, история не теряется." }),
            onError: (err) => toast({ title: "Не сохранено", description: (err as Error).message, variant: "destructive" }),
          })}
        ><Save className="mr-1.5 h-4 w-4" aria-hidden="true" />Сохранить критерии</Button>
        <Button variant="ghost" onClick={() => setRows(config.criteria.map(toDraft))}>Сбросить изменения</Button>
      </div>
    </div>
  );
}
