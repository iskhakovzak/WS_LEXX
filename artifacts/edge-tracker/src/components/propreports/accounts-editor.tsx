/**
 * Broker account → trader mapping. Unmapped accounts are highlighted; curators edit, traders see their own.
 */
import * as React from "react";
import { Loader2, Plus, RefreshCw, Save, Trash2, Users } from "lucide-react";
import { DataTable, EmptyState, Panel, Pill, SortableTh, useTableSort } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { agoText, useDeleteAccount, useRefreshAccounts, useSaveAccounts, useUsers, type AccountMapping } from "./api";
import { PersonSelect } from "@/components/people/person-select";

const NONE = "__none";

type Row = { account: string; trader: string | null; active: boolean; notes: string; aliases: string; id: number | null; accountId: string | null; accountName: string | null; lastSyncedAt: string | null; lastFillAt: string | null };
type Indexed = { r: Row; i: number };

// Free-text columns (aliases, notes) aren't sortable, so typing never makes a row jump;
// unsaved new rows stay pinned at the bottom in insertion order.
const ACCOUNT_ACCESSORS = {
  account: (x: Indexed) => x.r.account,
  external: (x: Indexed) => [x.r.accountId, x.r.accountName].filter(Boolean).join(" · ") || null,
  trader: (x: Indexed) => x.r.trader,
  active: (x: Indexed) => (x.r.active ? 1 : 0),
  lastFill: (x: Indexed) => (x.r.lastFillAt ? Date.parse(x.r.lastFillAt) || null : null),
  synced: (x: Indexed) => (x.r.lastSyncedAt ? Date.parse(x.r.lastSyncedAt) || null : null),
};
const ACCOUNT_FIRST_DIR = { account: "asc", external: "asc", trader: "asc" } as const;

export function AccountsEditor({ accounts, staff, apiConfigured }: { accounts: AccountMapping[]; staff: boolean; apiConfigured: boolean }) {
  const { toast } = useToast();
  const users = useUsers(staff);
  const save = useSaveAccounts();
  const refresh = useRefreshAccounts();
  const del = useDeleteAccount();
  const [rows, setRows] = React.useState<Row[]>([]);
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    if (dirty) return;
    setRows(accounts.map((a) => ({ account: a.account, trader: a.trader, active: a.active, notes: a.notes ?? "", aliases: (a.aliases ?? []).join(", "), id: a.id, accountId: a.accountId, accountName: a.accountName, lastSyncedAt: a.lastSyncedAt, lastFillAt: a.lastFillAt })));
  }, [accounts, dirty]);

  const traders = (users.data ?? []).filter((u) => u.active !== false && u.role !== "guest").map((u) => u.name);
  const update = (i: number, patch: Partial<Row>) => { setRows((r) => r.map((x, n) => (n === i ? { ...x, ...patch } : x))); setDirty(true); };
  const addRow = () => { setRows((r) => [...r, { account: "", trader: null, active: true, notes: "", aliases: "", id: null, accountId: null, accountName: null, lastSyncedAt: null, lastFillAt: null }]); setDirty(true); };

  const onSave = async () => {
    const payload = rows.filter((r) => r.account.trim()).map((r) => ({ account: r.account.trim(), trader: r.trader, active: r.active, notes: r.notes || null, aliases: r.aliases.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean) }));
    if (!payload.length) return;
    try {
      await save.mutateAsync(payload);
      setDirty(false);
      toast({ title: "Привязка счетов сохранена" });
    } catch (e) {
      toast({ title: "Не сохранилось", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const onRefresh = async () => {
    try {
      const r = await refresh.mutateAsync();
      toast({ title: `Получено счетов из API: ${r.fetched}`, description: "Привязка трейдеров не менялась" });
    } catch (e) {
      toast({ title: "Не удалось получить счета", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const onDelete = async (row: Row, i: number) => {
    if (row.id == null) { setRows((r) => r.filter((_, n) => n !== i)); return; }
    if (!window.confirm(`Удалить счёт ${row.account} из привязки? Сделки в журнале останутся.`)) return;
    try { await del.mutateAsync(row.id); toast({ title: `Счёт ${row.account} удалён` }); }
    catch (e) { toast({ title: "Не удалилось", description: e instanceof Error ? e.message : String(e), variant: "destructive" }); }
  };

  const unmapped = rows.filter((r) => r.account && !r.trader).length;
  const saved = React.useMemo(() => rows.map((r, i) => ({ r, i })).filter((x) => x.r.id != null), [rows]);
  const fresh = React.useMemo(() => rows.map((r, i) => ({ r, i })).filter((x) => x.r.id == null), [rows]);
  const sort = useTableSort(saved, ACCOUNT_ACCESSORS, "account", "asc", ACCOUNT_FIRST_DIR);
  const ordered = React.useMemo(() => [...sort.rows, ...fresh], [sort.rows, fresh]);

  return (
    <Panel
      title="Счета и трейдеры"
      description="Имя счёта должно совпадать с колонкой Account в Fills CSV / API (сопоставление: точное → без учёта регистра → без ведущих нулей/суффиксов → псевдонимы). Сделки по непривязанным счетам в журнал не попадают."
      icon={Users}
      actions={staff ? (
        <>
          {unmapped > 0 && <Pill tone="warn" dot>{unmapped} без трейдера</Pill>}
          {apiConfigured && (
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={refresh.isPending}>
              {refresh.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}Из API
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={addRow}><Plus className="mr-1.5 h-4 w-4" />Счёт</Button>
          <Button size="sm" onClick={onSave} disabled={!dirty || save.isPending}>
            {save.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}Сохранить
          </Button>
        </>
      ) : undefined}
    >
      {!rows.length ? (
        <EmptyState icon={Users} title={staff ? "Счета ещё не добавлены" : "Вам не привязан ни один счёт"} description={staff ? "Добавьте счёт вручную (как он называется в PropReports) или подтяните список из API." : "Попросите куратора привязать ваш брокерский счёт."} action={staff ? <Button size="sm" onClick={addRow}><Plus className="mr-1.5 h-4 w-4" />Добавить счёт</Button> : undefined} />
      ) : (
        <DataTable ariaLabel="Привязка счетов">
          <table>
            <thead>
              <tr>
                <SortableTh {...sort.thProps("account")}>Счёт (Account)</SortableTh>
                <SortableTh {...sort.thProps("external")}>Account Id / имя</SortableTh>
                <SortableTh {...sort.thProps("trader")}>Трейдер</SortableTh>
                <SortableTh {...sort.thProps("active")}>Активен</SortableTh>
                <th>Псевдонимы</th>
                <SortableTh {...sort.thProps("lastFill")}>Последний fill</SortableTh>
                <SortableTh {...sort.thProps("synced")}>Синхронизирован</SortableTh>
                <th>Заметка</th>
                {staff && <th className="w-10" />}
              </tr>
            </thead>
            <tbody>
              {ordered.map(({ r, i }) => (
                <tr key={r.id ?? `new-${i}`} className={cn(r.account && !r.trader && "bg-[hsl(var(--chart-3))]/5")}>
                  <td>
                    {staff && r.id == null ? (
                      <Input value={r.account} onChange={(e) => update(i, { account: e.target.value })} placeholder="напр. WSL123" className="h-8 w-44 font-mono text-xs" />
                    ) : (
                      <span className="font-mono text-xs">{r.account}</span>
                    )}
                  </td>
                  <td className="text-xs text-muted-foreground">{[r.accountId, r.accountName].filter(Boolean).join(" · ") || "—"}</td>
                  <td>
                    {staff ? (
                      <PersonSelect
                        value={r.trader ?? NONE}
                        onValueChange={(v) => update(i, { trader: v === NONE ? null : v })}
                        allValue={NONE}
                        allLabel="Не привязан"
                        options={r.trader && !traders.includes(r.trader) ? [...traders, r.trader] : traders}
                        ariaLabel={`Трейдер для счёта ${r.account}`}
                        className={cn("h-8 w-44 text-xs", !r.trader && "text-[hsl(var(--chart-3))]")}
                      />
                    ) : (
                      r.trader ?? <span className="text-[hsl(var(--chart-3))]">не привязан</span>
                    )}
                  </td>
                  <td>{staff ? <Switch checked={r.active} onCheckedChange={(v) => update(i, { active: v })} aria-label="Активен" /> : <Pill tone={r.active ? "up" : "neutral"}>{r.active ? "да" : "нет"}</Pill>}</td>
                  <td>{staff ? <Input value={r.aliases} onChange={(e) => update(i, { aliases: e.target.value })} className="h-8 w-44 font-mono text-xs" placeholder="WSL123, wsl-123" title="Другие написания этого счёта в файлах/API (через запятую)" /> : <span className="font-mono text-xs text-muted-foreground">{r.aliases || "—"}</span>}</td>
                  <td className="whitespace-nowrap text-xs text-muted-foreground">{r.lastFillAt ? r.lastFillAt.replace("T", " ").slice(0, 16) : "—"}</td>
                  <td className="whitespace-nowrap text-xs text-muted-foreground">{r.lastSyncedAt ? agoText(r.lastSyncedAt) : "—"}</td>
                  <td>{staff ? <Input value={r.notes} onChange={(e) => update(i, { notes: e.target.value })} className="h-8 w-48 text-xs" placeholder="комментарий" /> : <span className="text-xs text-muted-foreground">{r.notes || "—"}</span>}</td>
                  {staff && (
                    <td>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onDelete(r, i)} aria-label="Удалить счёт"><Trash2 className="h-4 w-4" /></Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      )}
    </Panel>
  );
}
