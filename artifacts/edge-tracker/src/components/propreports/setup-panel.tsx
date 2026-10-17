/**
 * «Мастер настройки» for the PropReports integration (curators only):
 *   env set → connection checked → accounts matched → fees confirmed → first sync.
 * Plus the three self-configuration blocks: group picker, fee columns, unmatched accounts.
 * Nothing here asks for or shows secrets — env var NAMES only; the connection check is a read-only
 * `version` call on the server.
 */
import * as React from "react";
import { AlertCircle, CheckCircle2, Circle, Coins, Layers, Loader2, PlugZap, RefreshCw, Save, UserX, Wand2 } from "lucide-react";
import { DataTable, EmptyState, Kbd, Panel, Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  agoText, useCheckConnection, useGroups, useSaveAccounts, useSaveSettings, useUsers,
  type AccountMapping, type FeeColumnView, type Status, type WizardStep,
} from "./api";
import { PersonSelect } from "@/components/people/person-select";

/* ── wizard ───────────────────────────────────────────────────────────────── */

const STEPS: Array<{ key: keyof Status["wizard"]; title: string; hint: string }> = [
  { key: "env", title: "Переменные окружения", hint: "PROPREPORTS_DOMAIN + PROPREPORTS_TOKEN (или USER + PASSWORD) в .env.local, затем перезапуск сервера" },
  { key: "connection", title: "Подключение проверено", hint: "Read-only запрос version: определяет API v2 (токен) или legacy-логин" },
  { key: "accounts", title: "Счета сопоставлены", hint: "Каждый счёт из файлов/API привязан к трейдеру; псевдонимы — для других написаний" },
  { key: "fees", title: "Комиссии подтверждены", hint: "Какие колонки комиссий суммируются в fees сделки" },
  { key: "firstSync", title: "Первый импорт / синк", hint: "Импорт Fills CSV или запуск «Синхронизировать сейчас»" },
];

function StepIcon({ step }: { step: WizardStep }) {
  if (step.ok) return <CheckCircle2 className="h-5 w-5 text-up" aria-hidden="true" />;
  return <Circle className="h-5 w-5 text-muted-foreground" aria-hidden="true" />;
}

export function SetupWizard({ status }: { status: Status }) {
  const { toast } = useToast();
  const check = useCheckConnection();
  const done = STEPS.filter((s) => status.wizard[s.key].ok).length;
  const onCheck = async () => {
    try {
      const r = await check.mutateAsync();
      toast({
        title: r.ok ? `Подключение работает: ${r.mode === "v2" ? "API v2 (токен)" : "legacy-логин"}` : "Подключение не удалось",
        description: r.ok ? `${r.host}${r.version ? ` · версия ${r.version}` : ""}` : r.error ?? undefined,
        variant: r.ok ? undefined : "destructive",
      });
    } catch (e) {
      toast({ title: "Проверка не выполнена", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };
  return (
    <Panel title="Мастер настройки" description={`${done} из ${STEPS.length} шагов выполнено`} icon={Wand2}
      actions={<Pill tone={done === STEPS.length ? "up" : "warn"} dot>{done === STEPS.length ? "готово" : "не завершено"}</Pill>}>
      <ol className="grid gap-2">
        {STEPS.map((s, i) => {
          const step = status.wizard[s.key];
          return (
            <li key={s.key} className={cn("flex items-start gap-3 rounded-xl border p-3", step.ok ? "border-[var(--glass-border)]" : "border-dashed border-[hsl(var(--chart-3)/0.5)]")}>
              <StepIcon step={step} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <span className="text-muted-foreground">{i + 1}.</span> {s.title}
                  {!step.ok && s.key === "connection" && status.connection.ok === false && <AlertCircle className="h-4 w-4 text-down" aria-hidden="true" />}
                </div>
                <div className={cn("text-xs", step.ok ? "text-muted-foreground" : "text-foreground")}>{step.detail}</div>
                {!step.ok && <div className="mt-0.5 text-xs text-muted-foreground">{s.hint}</div>}
                {s.key === "env" && !step.ok && (
                  <div className="mt-1 flex flex-wrap gap-1 font-mono text-[11px]">
                    {status.config.envVars.map((v) => <Kbd key={v}>{v}</Kbd>)}
                  </div>
                )}
              </div>
              {s.key === "connection" && status.config.configured && (
                <Button size="sm" variant={step.ok ? "outline" : "default"} onClick={onCheck} disabled={check.isPending}>
                  {check.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <PlugZap className="mr-1.5 h-4 w-4" />}Проверить подключение
                </Button>
              )}
            </li>
          );
        })}
      </ol>
      {status.connection.checkedAt && (
        <p className="mt-2 text-xs text-muted-foreground">
          Последняя проверка {agoText(status.connection.checkedAt)}: {status.connection.ok ? `OK · ${status.connection.mode === "v2" ? "API v2 (токен)" : "legacy-логин"}${status.connection.version ? ` · версия ${status.connection.version}` : ""}` : `ошибка — ${status.connection.error ?? "неизвестно"}`}
        </p>
      )}
    </Panel>
  );
}

/* ── group picker ─────────────────────────────────────────────────────────── */

const MY_ACCOUNTS = "-4";

export function GroupPicker({ status }: { status: Status }) {
  const { toast } = useToast();
  const [wanted, setWanted] = React.useState(false);
  const groups = useGroups(wanted && status.config.configured);
  const save = useSaveSettings();
  const [choice, setChoice] = React.useState<string>(status.settings.groupId ?? MY_ACCOUNTS);
  React.useEffect(() => { setChoice(status.settings.groupId ?? MY_ACCOUNTS); }, [status.settings.groupId]);
  if (!status.config.configured) return null;
  const envWins = status.settings.groupSource === "env";
  const list = groups.data?.groups ?? [];
  const onSave = async () => {
    try {
      await save.mutateAsync({ groupId: choice === MY_ACCOUNTS ? null : choice });
      toast({ title: "Группа сохранена", description: choice === MY_ACCOUNTS ? "Будут выбираться «My Accounts» (-4)" : `groupId ${choice}` });
    } catch (e) {
      toast({ title: "Не сохранилось", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };
  return (
    <Panel title="Группа PropReports" description="Чьи fills забирать по API. По умолчанию «My Accounts» (-4) — все счета, доступные токену." icon={Layers}
      actions={<Pill tone="neutral">сейчас: {status.settings.effectiveGroupId}{envWins ? " (из .env)" : status.settings.groupSource === "settings" ? " (из настроек)" : " (по умолчанию)"}</Pill>}>
      {envWins ? (
        <p className="text-sm text-muted-foreground">Группа задана переменной <Kbd>PROPREPORTS_GROUP_ID</Kbd> — она имеет приоритет над выбором здесь.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <Button variant="outline" size="sm" onClick={() => { setWanted(true); if (wanted) groups.refetch(); }} disabled={groups.isFetching}>
            {groups.isFetching ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}Загрузить группы
          </Button>
          <Select value={choice} onValueChange={setChoice}>
            <SelectTrigger className="h-9 w-72 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={MY_ACCOUNTS}>My Accounts (-4) — по умолчанию</SelectItem>
              {list.map((g) => (
                <SelectItem key={`${g.groupId ?? "name"}:${g.name}`} value={g.groupId ?? `name:${g.name}`} disabled={!g.groupId}>
                  {g.name}{g.groupId ? ` (${g.groupId})` : " — id неизвестен"}
                </SelectItem>
              ))}
              {status.settings.groupId && !list.some((g) => g.groupId === status.settings.groupId) && <SelectItem value={status.settings.groupId}>groupId {status.settings.groupId}</SelectItem>}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={onSave} disabled={save.isPending || choice === (status.settings.groupId ?? MY_ACCOUNTS)}>
            {save.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}Сохранить
          </Button>
          {groups.error ? <span className="text-xs text-down">{groups.error instanceof Error ? groups.error.message : "Ошибка загрузки групп"}</span> : null}
          {groups.data?.source === "accounts" && <span className="text-xs text-muted-foreground">API не отдаёт список групп — показаны имена из списка счетов (без id выбрать нельзя; задайте PROPREPORTS_GROUP_ID вручную).</span>}
        </div>
      )}
    </Panel>
  );
}

/* ── fee columns ──────────────────────────────────────────────────────────── */

type FeeRow = FeeColumnView & { dirty?: boolean };

export function FeeSettings({ status }: { status: Status }) {
  const { toast } = useToast();
  const save = useSaveSettings();
  const [rows, setRows] = React.useState<FeeRow[]>(status.settings.feeColumns);
  const [dirty, setDirty] = React.useState(false);
  React.useEffect(() => { if (!dirty) setRows(status.settings.feeColumns); }, [status.settings.feeColumns, dirty]);
  const update = (key: string, patch: Partial<FeeRow>) => { setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch, dirty: true } : x))); setDirty(true); };
  const onSave = async (confirm: boolean) => {
    const columns: Record<string, { include: boolean; label?: string | null }> = {};
    for (const r of rows) if (r.dirty || confirm) columns[r.key] = { include: r.include, label: r.customLabel?.trim() || null };
    try {
      await save.mutateAsync({ fees: { columns, confirm } });
      setDirty(false);
      toast({ title: confirm ? "Комиссии подтверждены" : "Настройки комиссий сохранены", description: "Применится при следующем импорте/синке (fees пересчитываются по включённым колонкам)" });
    } catch (e) {
      toast({ title: "Не сохранилось", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };
  const included = rows.filter((r) => r.include).length;
  return (
    <Panel title="Комиссии" description="Колонки, найденные в последнем импорте/синке. Выключенные не входят в fees и net P&L сделки (gross не меняется)." icon={Coins}
      actions={
        <>
          <Pill tone={status.settings.feesConfirmedAt ? "up" : "warn"} dot>{status.settings.feesConfirmedAt ? `подтверждено ${agoText(status.settings.feesConfirmedAt)}` : "не подтверждено"}</Pill>
          <Button variant="outline" size="sm" onClick={() => onSave(false)} disabled={!dirty || save.isPending}>Сохранить</Button>
          <Button size="sm" onClick={() => onSave(true)} disabled={!rows.length || save.isPending}>
            {save.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}Подтвердить ({included}/{rows.length})
          </Button>
        </>
      }
    >
      {!rows.length ? (
        <EmptyState icon={Coins} title="Колонки ещё не обнаружены" description="Сделайте предпросмотр и импорт Fills CSV / отчёта Trades или запустите синк — все колонки комиссий (известные и неизвестные числовые) появятся здесь." />
      ) : (
        <DataTable ariaLabel="Колонки комиссий">
          <table>
            <thead>
              <tr><th>Учитывать</th><th>Колонка в файле</th><th>Название в журнале</th><th>Тип</th><th>Видели</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={cn(!r.include && "opacity-60")}>
                  <td><Switch checked={r.include} onCheckedChange={(v) => update(r.key, { include: v })} aria-label={`Учитывать ${r.header ?? r.key}`} /></td>
                  <td className="font-mono text-xs">{r.header ?? r.key}<span className="ml-1 text-muted-foreground">({r.key})</span></td>
                  <td><Input value={r.customLabel ?? ""} placeholder={r.label} onChange={(e) => update(r.key, { customLabel: e.target.value })} className="h-8 w-full min-w-[8rem] max-w-[12rem] text-xs" /></td>
                  <td>{r.known ? <Pill tone="accent">известная</Pill> : r.heuristic ? <Pill tone="warn">по эвристике</Pill> : <Pill tone="neutral">по названию</Pill>}</td>
                  <td className="whitespace-nowrap text-xs text-muted-foreground">{r.lastSeenAt ? agoText(r.lastSeenAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      )}
    </Panel>
  );
}

/* ── unmatched accounts ───────────────────────────────────────────────────── */

const NONE = "__none";

export function UnmatchedAccounts({ status, accounts }: { status: Status; accounts: AccountMapping[] }) {
  const { toast } = useToast();
  const users = useUsers(true);
  const saveAccounts = useSaveAccounts();
  const saveSettings = useSaveSettings();
  const names = status.settings.unmatched;
  const traders = (users.data ?? []).filter((u) => u.active !== false && u.role !== "guest").map((u) => u.name);
  const [pick, setPick] = React.useState<Record<string, string>>({});
  const busy = saveAccounts.isPending || saveSettings.isPending;

  const asNew = async (name: string) => {
    const trader = pick[`t:${name}`];
    if (!trader) return;
    try { await saveAccounts.mutateAsync([{ account: name, trader, active: true, aliases: [] }]); toast({ title: `Счёт ${name} → ${trader}` }); }
    catch (e) { toast({ title: "Не сохранилось", description: e instanceof Error ? e.message : String(e), variant: "destructive" }); }
  };
  const asAlias = async (name: string) => {
    const target = accounts.find((a) => a.account === pick[`a:${name}`]);
    if (!target) return;
    try {
      await saveAccounts.mutateAsync([{ account: target.account, trader: target.trader, active: target.active, notes: target.notes, aliases: [...new Set([...(target.aliases ?? []), name])] }]);
      toast({ title: `«${name}» — псевдоним счёта ${target.account}` });
    } catch (e) { toast({ title: "Не сохранилось", description: e instanceof Error ? e.message : String(e), variant: "destructive" }); }
  };
  const dismiss = async (name: string) => {
    try { await saveSettings.mutateAsync({ unmatched: names.filter((n) => n !== name) }); }
    catch (e) { toast({ title: "Не удалось", description: e instanceof Error ? e.message : String(e), variant: "destructive" }); }
  };

  return (
    <Panel title="Несопоставленные счета" description="Имена счетов из файлов/API, которые не совпали ни с одним счётом (точно, без учёта регистра, без ведущих нулей, по псевдонимам)." icon={UserX}
      actions={names.length ? <Pill tone="warn" dot>{names.length}</Pill> : <Pill tone="up" dot>всё сопоставлено</Pill>}>
      {!names.length ? (
        <p className="text-sm text-muted-foreground">Пусто — все счета из последних импортов нашли свою привязку.</p>
      ) : (
        <ul className="grid gap-2">
          {names.map((name) => (
            <li key={name} className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[hsl(var(--chart-3)/0.5)] p-3 text-sm">
              <span className="font-mono">{name}</span>
              <span className="text-xs text-muted-foreground">→ новый счёт для</span>
              <PersonSelect
                value={pick[`t:${name}`] || NONE}
                onValueChange={(v) => setPick((p) => ({ ...p, [`t:${name}`]: v === NONE ? "" : v }))}
                allValue={NONE}
                allLabel="трейдер…"
                options={traders}
                ariaLabel="Трейдер для нового счёта"
                className="h-8 w-40 text-xs"
              />
              <Button size="sm" variant="outline" onClick={() => asNew(name)} disabled={busy || !pick[`t:${name}`]}>Привязать</Button>
              <span className="text-xs text-muted-foreground">или псевдоним счёта</span>
              <Select value={pick[`a:${name}`] ?? NONE} onValueChange={(v) => setPick((p) => ({ ...p, [`a:${name}`]: v === NONE ? "" : v }))}>
                <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="счёт" /></SelectTrigger>
                <SelectContent><SelectItem value={NONE}>счёт…</SelectItem>{accounts.map((a) => <SelectItem key={a.id} value={a.account}>{a.account}{a.trader ? ` — ${a.trader}` : ""}</SelectItem>)}</SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={() => asAlias(name)} disabled={busy || !pick[`a:${name}`]}>Добавить псевдоним</Button>
              <Button size="sm" variant="ghost" onClick={() => dismiss(name)} disabled={busy}>Скрыть</Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ── composite ────────────────────────────────────────────────────────────── */

export function SetupPanel({ status, accounts }: { status: Status; accounts: AccountMapping[] }) {
  return (
    <div className="grid gap-[var(--grid-gap)]">
      <SetupWizard status={status} />
      <GroupPicker status={status} />
      {/* The fee table needs the width; the unmatched list is usually one line («всё сопоставлено») — don't stretch it. */}
      <div className="grid items-start gap-[var(--grid-gap)] xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <FeeSettings status={status} />
        <UnmatchedAccounts status={status} accounts={accounts} />
      </div>
    </div>
  );
}
