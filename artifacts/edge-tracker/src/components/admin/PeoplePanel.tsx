/**
 * «Люди» — accounts management for the desk owner: role, tier, curator, PropReports accounts, status, activity.
 * Every change asks for a reason (ReasonDialog) and lands in the audit log. Status: active / frozen (banned,
 * login blocked) / archived (active=false, soft — nothing is deleted).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Archive, ArchiveRestore, Download, GraduationCap, KeyRound, Languages, Link2, LogOut, MoreHorizontal, Search, Snowflake, Sun,
  UserCog, UserPlus, Users, UsersRound, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { QueryError } from "@/components/query-error";
import {
  DataTable, EmptyState, FilterChip, Kbd, Panel, Pill, Segmented, SortableTh, TableSkeleton, useTableSort, type Tone,
} from "@/components/ds";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { ROLE_LABEL, downloadCsv, isTypingTarget, timeAgo, type DeskPulse } from "./api";
import {
  NotDeployedError, useCreatePerson, useMapAccount, usePeople, usePeopleAction, useSetNameLatin, useTiers,
  type PeopleActionInput, type PeopleActionKind, type Person, type PersonStatus,
} from "./console-api";
import { ReasonDialog, type ReasonDialogState } from "./ReasonDialog";
import { TradersTable, type RiskStatus, type TraderFilter } from "./TradersTable";
import { useUserActions } from "./useUserActions";
import { profileHref } from "@/components/curator/curator-math";
import { PersonSelect } from "@/components/people/person-select";
import { Highlight } from "@/components/people/highlight";
import { matchText, prepareQuery } from "@/components/people/search";
import { fmtDate } from "@/lib/format";
import { secretMinFor } from "@/lib/secret-policy";
import { authI18n } from "@/i18n/ns/auth";

/** Date + time with seconds ("17.10.2026, 14:05:09" in RU), the shape of the old bare toLocaleString(). */

const NL = {
  menu: "Латинское имя…",
  title: (name: string) => `Латинское имя: ${name}`,
  description: "Для поиска: имя найдётся и по-русски, и латиницей. Это не переименование — в журнале и сделках остаётся прежнее имя.",
  label: "Латиницей",
  placeholder: "Например: Zakir Ishakov",
  save: "Сохранить",
  clear: "Убрать",
  saved: (name: string) => `Латинское имя для ${name} сохранено`,
  removed: (name: string) => `Латинское имя для ${name} убрано`,
  hint: "латиницей — для поиска",
  group: (n: number) => `группа · ${n}`,
  groupTitle: (name: string) => `Открыть группу ${name} в кабинете куратора`,
  searchPlaceholder: "Имя (рус/лат), счёт или куратор",
} as const;

export type PeopleView = "manage" | "activity";
type Filter = "all" | "traders" | "staff" | "active" | "frozen" | "archived" | "nocurator" | "noaccount";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "traders", label: "Трейдеры" },
  { value: "staff", label: "Кураторы и админы" },
  { value: "active", label: "Активные" },
  { value: "frozen", label: "Заморожены" },
  { value: "archived", label: "Архив" },
  { value: "nocurator", label: "Без куратора" },
  { value: "noaccount", label: "Без счёта" },
];

const TIER_FALLBACK: Record<string, string> = { trainee: "Стажёр", junior: "Джун", trader: "Трейдер", senior: "Сеньор", lead: "Лид" };

const STATUS: Record<PersonStatus, { label: string; tone: Tone }> = {
  active: { label: "Активен", tone: "up" },
  frozen: { label: "Заморожен", tone: "warn" },
  archived: { label: "Архив", tone: "neutral" },
};

const PRESETS: Record<PeopleActionKind | "map", string[]> = {
  freeze: ["Нарушение риск-правил", "Пауза по решению деска", "Подозрительная активность"],
  unfreeze: ["Вопрос решён", "Пауза окончена"],
  archive: ["Ушёл из команды", "Не прошёл стажировку", "Дубликат учётки"],
  restore: ["Вернулся в команду", "Архивирован по ошибке"],
  sessions: ["Утеря устройства", "Подозрительный вход", "Смена пароля"],
  curator: ["Распределение нагрузки", "Новый трейдер", "По запросу трейдера"],
  role: ["Повышение", "Изменение обязанностей"],
  tier: ["Выполнил критерии перехода", "Понижение по результатам", "Решение деска"],
  map: ["Новый счёт трейдера", "Исправление привязки"],
};

function matches(p: Person, f: Filter) {
  switch (f) {
    case "traders": return p.role === "trader";
    case "staff": return p.role !== "trader";
    case "active": return p.status === "active";
    case "frozen": return p.status === "frozen";
    case "archived": return p.status === "archived";
    case "nocurator": return p.role === "trader" && p.status !== "archived" && !p.curator;
    case "noaccount": return p.role === "trader" && p.status !== "archived" && p.accounts.length === 0;
    default: return true;
  }
}

function roleTone(role: string): Tone {
  return role === "admin" ? "purple" : role === "curator" ? "accent" : "neutral";
}

type Row = Person & { seen: string | null };
const ACCESSORS = {
  name: (p: Row) => p.name,
  role: (p: Row) => (p.role === "admin" ? 0 : p.role === "curator" ? 1 : 2),
  tier: (p: Row) => p.tier ?? null,
  curator: (p: Row) => p.curator ?? null,
  status: (p: Row) => p.status,
  seen: (p: Row) => (p.seen ? Date.parse(p.seen) : null),
  trades: (p: Row) => p.trades30,
};

function later(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

export function PeoplePanel({
  actor, pulse, pulseLoading, pulseError, onPulseRetry, riskStatus, view, onViewChange, activityFilter, onActivityFilterChange,
}: {
  actor: string;
  pulse: DeskPulse | undefined;
  pulseLoading: boolean;
  pulseError: unknown;
  onPulseRetry: () => void;
  riskStatus?: Map<string, RiskStatus>;
  view: PeopleView;
  onViewChange: (v: PeopleView) => void;
  activityFilter: TraderFilter;
  onActivityFilterChange: (f: TraderFilter) => void;
}) {
  const { can, isAdmin, refreshUsers } = useAuth();
  const { toast } = useToast();
  const people = usePeople();
  const tiers = useTiers();
  const action = usePeopleAction(actor);
  const create = useCreatePerson();
  const mapAccount = useMapAccount();
  const legacy = useUserActions(actor, refreshUsers);

  const canManage = can("users.manage");
  const canAdmins = can("users.manage.admins");
  const canTier = can("scaling.approve");
  const canMap = can("propreports.configure");

  const [filter, setFilter] = useState<Filter>("active");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [dialog, setDialog] = useState<ReasonDialogState>(null);
  const [addOpen, setAddOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (view !== "manage") return;
      if (e.key === "/" && !isTypingTarget(e.target) && !e.ctrlKey && !e.metaKey) { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);

  const tierName = useMemo(() => {
    const m: Record<string, string> = { ...TIER_FALLBACK };
    for (const t of tiers.data ?? []) m[t.key] = t.name;
    return m;
  }, [tiers.data]);
  const tierList = tiers.data?.length ? tiers.data : Object.entries(TIER_FALLBACK).slice(0, 4).map(([key, name], i) => ({ key, name, order: i + 1 }));

  const seenBy = useMemo(() => new Map((pulse?.users ?? []).map((u) => [u.name, u.lastSeen])), [pulse]);
  const all: Row[] = useMemo(
    () => (people.data?.people ?? []).map((p) => ({ ...p, seen: later(p.lastSeen, seenBy.get(p.name) ?? null) })),
    [people.data, seenBy],
  );
  const curators = useMemo(() => all.filter((p) => p.role !== "trader" && p.status === "active").map((p) => p.name), [all]);
  const traderNames = useMemo(() => all.filter((p) => p.status === "active").map((p) => p.name), [all]);

  const counts = useMemo(() => {
    const c = {} as Record<Filter, number>;
    for (const f of FILTERS) c[f.value] = all.filter((p) => matches(p, f.value)).length;
    return c;
  }, [all]);
  // Cross-script search (RU / EN / UZ, wrong keyboard layout, typos): name, Latin alias, curator, accounts.
  const pq = useMemo(() => prepareQuery(q), [q]);
  const hitBy = useMemo(() => {
    const m = new Map<number, { ranges: [number, number][]; latin: boolean }>();
    if (pq.empty) return m;
    for (const p of all) {
      const byName = matchText(pq, p.name);
      const byLatin = matchText(pq, p.nameLatin);
      if (byName || byLatin) m.set(p.id, { ranges: (byName ?? byLatin)!.ranges, latin: !byName });
      else if (matchText(pq, p.curator) || p.accounts.some((a) => matchText(pq, a))) m.set(p.id, { ranges: [], latin: false });
    }
    return m;
  }, [all, pq]);
  const filtered = useMemo(() => all.filter((p) => matches(p, filter) && (pq.empty || hitBy.has(p.id))), [all, filter, pq, hitBy]);
  const groupSize = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of all) if (p.role === "trader" && p.status === "active" && p.curator) m.set(p.curator, (m.get(p.curator) ?? 0) + 1);
    return m;
  }, [all]);
  const setLatin = useSetNameLatin();
  const [latinFor, setLatinFor] = useState<Person | null>(null);
  const { rows, thProps } = useTableSort(filtered, ACCESSORS, "role", "asc");

  // Selection only keeps visible rows.
  useEffect(() => {
    setSelected((prev) => {
      const visible = new Set(rows.map((r) => r.id));
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const allChecked = rows.length > 0 && selectedRows.length === rows.length;

  /* ── actions ── */

  const run = (input: PeopleActionInput, success: string) => {
    action.mutate(input, {
      onSuccess: (r) => {
        setDialog(null);
        setSelected(new Set());
        refreshUsers();
        if (r.skipped.length) {
          toast({
            title: `${success}: ${r.done.length} из ${r.done.length + r.skipped.length}`,
            description: r.skipped.slice(0, 4).map((s) => `${s.name ?? "?"} — ${s.error}`).join("; "),
          });
        } else {
          toast({ title: success, description: r.done.length > 1 ? r.done.join(", ") : r.done[0] });
        }
      },
      onError: (e) => {
        if (e instanceof NotDeployedError) setDialog(null);
        toast({ title: e instanceof NotDeployedError ? "Нужен перезапуск API" : "Ошибка", description: e.message, variant: "destructive" });
      },
    });
  };

  const ask = (kind: PeopleActionKind, targets: Person[], opts: { curator?: string | null; role?: string; tierKey?: string } = {}) => {
    const who = targets.length === 1 ? targets[0]!.name : `${targets.length} чел.`;
    const meta: Record<PeopleActionKind, { title: string; description: string; confirm: string; destructive?: boolean; success: string }> = {
      freeze: { title: `Заморозить ${who}?`, description: "Вход будет заблокирован, активные сессии завершатся. Данные сохраняются.", confirm: "Заморозить", destructive: true, success: "Заморожено" },
      unfreeze: { title: `Разморозить ${who}?`, description: "Пользователь снова сможет войти.", confirm: "Разморозить", success: "Разморожено" },
      archive: { title: `Отправить в архив ${who}?`, description: "Учётка скрывается из списков и не может войти. Сделки и журнал остаются — вернуть можно в любой момент.", confirm: "В архив", destructive: true, success: "Отправлено в архив" },
      restore: { title: `Вернуть из архива ${who}?`, description: "Учётка снова появится в списках и сможет войти.", confirm: "Вернуть", success: "Возвращено из архива" },
      sessions: { title: `Сбросить сессии ${who}?`, description: "Все устройства будут разлогинены. Пароль не меняется.", confirm: "Сбросить", success: "Сессии сброшены" },
      curator: { title: opts.curator ? `Назначить куратора ${opts.curator}?` : `Снять куратора?`, description: `Для: ${targets.map((t) => t.name).join(", ")}.`, confirm: opts.curator ? "Назначить" : "Снять", success: opts.curator ? `Куратор: ${opts.curator}` : "Куратор снят" },
      role: { title: `Сменить роль ${who}?`, description: `${ROLE_LABEL[targets[0]?.role ?? ""] ?? targets[0]?.role} → ${ROLE_LABEL[opts.role ?? ""] ?? opts.role}. Пользователю нужно будет войти заново.`, confirm: "Сменить роль", success: "Роль обновлена" },
      tier: { title: `Назначить тир «${tierName[opts.tierKey ?? ""] ?? opts.tierKey}» — ${who}?`, description: "Лимиты тира применятся сразу; трейдер получит уведомление. Причина попадёт в историю масштабирования и аудит.", confirm: "Назначить тир", success: "Тир назначен" },
    };
    const m = meta[kind];
    setDialog({
      title: m.title,
      description: m.description,
      confirmLabel: m.confirm,
      destructive: m.destructive,
      input: { label: "Причина (попадёт в аудит)", kind: "textarea", required: true, minLength: 3, presets: PRESETS[kind], placeholder: "Коротко: почему" },
      onConfirm: (reason) => run({ kind, people: targets, reason, ...opts }, m.success),
    });
  };

  const askMap = (account: string, trader: string) => setDialog({
    title: `Привязать счёт ${account} к ${trader}?`,
    description: "Сделки с этого счёта при следующем импорте попадут в журнал трейдера. Уже загруженные сделки не переписываются.",
    confirmLabel: "Привязать",
    input: { label: "Причина (попадёт в аудит)", kind: "textarea", required: true, minLength: 3, presets: PRESETS.map, placeholder: "Коротко: почему" },
    onConfirm: (reason) => mapAccount.mutate({ account, trader, reason }, {
      onSuccess: (r) => { setDialog(null); toast({ title: `Счёт ${account} → ${trader}`, description: r.legacy ? "Сохранено через старый API — причина в аудит не попала." : undefined }); },
      onError: (e) => toast({ title: "Ошибка", description: e.message, variant: "destructive" }),
    }),
  });

  const canTouch = (p: Person) => canManage && (p.role !== "admin" || canAdmins);
  const isSelf = (p: Person) => p.name === actor;

  const exportCsv = () => downloadCsv(
    ["Имя", "Латиницей", "Роль", "Тир", "Куратор", "Счета PropReports", "Статус", "Последняя активность", "Сделок за 30 дн", "Последний день сделок", "Создан"],
    rows.map((p) => [p.name, p.nameLatin ?? "", ROLE_LABEL[p.role] ?? p.role, p.tier ? tierName[p.tier] ?? p.tier : "", p.curator ?? "", p.accounts.join(" "), STATUS[p.status].label, p.seen ?? "", p.trades30, p.lastTrade ?? "", p.createdAt ?? ""]),
    `people-${new Date().toISOString().slice(0, 10)}.csv`,
  );

  const menu = (p: Row) => {
    const self = isSelf(p);
    const touch = canTouch(p);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Действия: ${p.name}`} disabled={!touch && !canTier}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="text-xs text-muted-foreground">{p.name}</DropdownMenuLabel>
          {touch && p.role === "trader" && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><UserCog /> Куратор: {p.curator ?? "нет"}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={p.curator ?? ""} onValueChange={(c) => { if (c !== (p.curator ?? "")) ask("curator", [p], { curator: c || null }); }}>
                  {curators.map((c) => <DropdownMenuRadioItem key={c} value={c}>{c}</DropdownMenuRadioItem>)}
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioItem value="">Без куратора</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {canTier && p.role === "trader" && p.status === "active" && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><GraduationCap /> Тир: {p.tier ? tierName[p.tier] ?? p.tier : "нет"}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={p.tier ?? ""} onValueChange={(k) => { if (k && k !== p.tier) ask("tier", [p], { tierKey: k }); }}>
                  {tierList.map((t) => <DropdownMenuRadioItem key={t.key} value={t.key}>{t.name}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {touch && !self && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><Users /> Роль: {ROLE_LABEL[p.role] ?? p.role}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={p.role} onValueChange={(r) => { if (r !== p.role) ask("role", [p], { role: r }); }}>
                  {(canAdmins ? ["trader", "curator", "admin"] : ["trader", "curator"]).map((r) => (
                    <DropdownMenuRadioItem key={r} value={r}>{ROLE_LABEL[r]}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {touch && <DropdownMenuItem onSelect={() => window.setTimeout(() => setLatinFor(p), 0)}><Languages /> {NL.menu}</DropdownMenuItem>}
          {touch && <DropdownMenuItem onSelect={() => legacy.setPassword(p)}><KeyRound /> Задать пароль</DropdownMenuItem>}
          {touch && <DropdownMenuItem onSelect={() => ask("sessions", [p])}><LogOut /> Сбросить сессии</DropdownMenuItem>}
          {touch && !self && (
            <>
              <DropdownMenuSeparator />
              {p.status === "frozen"
                ? <DropdownMenuItem onSelect={() => ask("unfreeze", [p])}><Sun /> Разморозить</DropdownMenuItem>
                : p.status === "active" && p.role !== "admin" && (p.role !== "curator" || canAdmins) && (
                  <DropdownMenuItem onSelect={() => ask("freeze", [p])} className="text-[hsl(var(--chart-3))] focus:text-[hsl(var(--chart-3))]"><Snowflake /> Заморозить…</DropdownMenuItem>
                )}
              {p.status === "archived"
                ? <DropdownMenuItem onSelect={() => ask("restore", [p])}><ArchiveRestore /> Вернуть из архива</DropdownMenuItem>
                : (p.role !== "curator" || canAdmins) && <DropdownMenuItem onSelect={() => ask("archive", [p])} className="text-down focus:text-down"><Archive /> В архив…</DropdownMenuItem>}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const unmatched = [
    ...(people.data?.accounts.unmatched ?? []).map((a) => ({ account: a, kind: "new" as const })),
    ...(people.data?.accounts.unmapped ?? []).map((a) => ({ account: a.account, kind: "unmapped" as const })),
  ];

  return (
    <div className="flex flex-col gap-[var(--grid-gap)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<PeopleView>
          ariaLabel="Вид"
          value={view}
          onChange={onViewChange}
          options={[{ value: "manage", label: "Управление" }, { value: "activity", label: "Активность за 14 дней" }]}
        />
        {view === "manage" && people.data?.source === "fallback" && (
          <span className="text-xs text-muted-foreground">Часть действий заработает после перезапуска API</span>
        )}
      </div>

      {view === "activity" ? (
        <TradersTable
          actor={actor}
          isAdmin={isAdmin}
          pulse={pulse}
          isLoading={pulseLoading}
          error={pulseError}
          onRetry={onPulseRetry}
          onChange={refreshUsers}
          filter={activityFilter}
          onFilterChange={onActivityFilterChange}
          riskStatus={riskStatus}
        />
      ) : (
        <>
          {canMap && unmatched.length > 0 && (
            <Panel title="Счета PropReports без трейдера" icon={Link2} description="Сделки с этих счетов не попадают в журнал. Выберите, чей это счёт.">
              <ul className="flex flex-col gap-2">
                {unmatched.map((u) => <AccountMatchRow key={`${u.kind}:${u.account}`} account={u.account} isNew={u.kind === "new"} traders={traderNames} onMap={askMap} />)}
              </ul>
            </Panel>
          )}

          <Panel
            title="Люди"
            icon={Users}
            description="Роль, тир, куратор, счета и статус. Каждое изменение — с причиной в журнале аудита."
            actions={
              <>
                <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}><Download /> CSV</Button>
                {canManage && <Button size="sm" onClick={() => setAddOpen(true)}><UserPlus /> Добавить</Button>}
              </>
            }
          >
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <div className="relative w-full md:max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    ref={searchRef}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); (e.target as HTMLInputElement).blur(); } }}
                    placeholder={NL.searchPlaceholder}
                    title="Имя можно вводить по-русски, латиницей, по-узбекски и даже в другой раскладке"
                    aria-label="Поиск по людям"
                    className="pl-9 pr-10"
                  />
                  <Kbd className="absolute right-3 top-1/2 -translate-y-1/2">/</Kbd>
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Фильтр людей">
                  {FILTERS.map((f) => (
                    <FilterChip key={f.value} active={filter === f.value} onClick={() => setFilter(f.value)} count={counts[f.value]} className="shrink-0">
                      {f.label}
                    </FilterChip>
                  ))}
                </div>
              </div>

              {selectedRows.length > 0 && (
                <BulkBar
                  count={selectedRows.length}
                  curators={curators}
                  tiers={canTier ? tierList : []}
                  tierEligible={selectedRows.filter((r) => r.role === "trader" && r.status === "active").length}
                  onClear={() => setSelected(new Set())}
                  onAction={(kind, opts) => ask(kind, kind === "tier" ? selectedRows.filter((r) => r.role === "trader" && r.status === "active") : selectedRows, opts)}
                  canManage={canManage}
                />
              )}

              {people.isError ? (
                <QueryError error={people.error} onRetry={() => people.refetch()} />
              ) : people.isLoading ? (
                <TableSkeleton rows={6} cols={7} />
              ) : rows.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title={all.length === 0 ? "Пользователей нет" : "Никого по этому фильтру"}
                  description={all.length === 0 ? "Добавьте первого трейдера." : "Смените фильтр или очистите поиск."}
                  action={all.length > 0 ? <Button variant="outline" size="sm" onClick={() => { setQ(""); setFilter("all"); }}>Показать всех</Button> : undefined}
                />
              ) : (
                <DataTable maxHeight="65vh" ariaLabel="Таблица людей">
                  <table>
                    <thead>
                      <tr>
                        {canManage && (
                          <th scope="col" className="w-8">
                            <Checkbox
                              checked={allChecked ? true : selectedRows.length ? "indeterminate" : false}
                              onCheckedChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())}
                              aria-label="Выбрать всех"
                            />
                          </th>
                        )}
                        <SortableTh {...thProps("name")}>Имя</SortableTh>
                        <SortableTh {...thProps("role")}>Роль</SortableTh>
                        <SortableTh {...thProps("tier")}>Тир</SortableTh>
                        <SortableTh {...thProps("curator")}>Куратор</SortableTh>
                        <th scope="col">Счета</th>
                        <SortableTh {...thProps("status")}>Статус</SortableTh>
                        <SortableTh {...thProps("seen")}>Активность</SortableTh>
                        <SortableTh {...thProps("trades")} align="right">Сделок 30д</SortableTh>
                        <th scope="col"><span className="sr-only">Действия</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((p) => (
                        <tr key={p.id} className={cn(p.status === "archived" && "opacity-60", selected.has(p.id) && "bg-[var(--glass-bg)]")}>
                          {canManage && (
                            <td>
                              <Checkbox
                                checked={selected.has(p.id)}
                                onCheckedChange={(v) => setSelected((prev) => { const n = new Set(prev); if (v) n.add(p.id); else n.delete(p.id); return n; })}
                                aria-label={`Выбрать ${p.name}`}
                              />
                            </td>
                          )}
                          <td>
                            <div className="flex min-w-0 items-center gap-1.5">
                              {p.role === "trader" ? (
                                <Link href={profileHref(p.name)} className="truncate rounded font-medium text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title={`Профиль ${p.name} в кабинете куратора`}>
                                  <Highlight text={p.name} ranges={hitBy.get(p.id)?.latin ? null : hitBy.get(p.id)?.ranges} />
                                </Link>
                              ) : (
                                <span className="truncate font-medium text-foreground"><Highlight text={p.name} ranges={hitBy.get(p.id)?.latin ? null : hitBy.get(p.id)?.ranges} /></span>
                              )}
                              {isSelf(p) && <span className="text-2xs text-muted-foreground">(вы)</span>}
                              {p.role !== "trader" && (groupSize.get(p.name) ?? 0) > 0 && (
                                <Link href={`/curator?view=traders&group=${encodeURIComponent(p.name)}`} title={NL.groupTitle(p.name)} className="chip inline-flex h-6 shrink-0 items-center gap-1 px-2 text-2xs tabular-nums">
                                  <UsersRound className="h-3 w-3" aria-hidden="true" />{NL.group(groupSize.get(p.name) ?? 0)}
                                </Link>
                              )}
                            </div>
                            {p.nameLatin && (
                              <div className="truncate text-2xs text-muted-foreground" title={NL.hint}>
                                <Highlight text={p.nameLatin} ranges={hitBy.get(p.id)?.latin ? hitBy.get(p.id)?.ranges : null} />
                              </div>
                            )}
                          </td>
                          <td><Pill tone={roleTone(p.role)}>{ROLE_LABEL[p.role] ?? p.role}</Pill></td>
                          <td>{p.role === "trader" ? (p.tier ? <span>{tierName[p.tier] ?? p.tier}</span> : <span className="text-muted-foreground">—</span>) : <span className="text-muted-foreground">—</span>}</td>
                          <td>{p.role === "trader" ? (p.curator ?? <span className="whitespace-nowrap text-[hsl(var(--chart-3))]">не назначен</span>) : <span className="text-muted-foreground">—</span>}</td>
                          <td>
                            {p.accounts.length
                              ? <span className="font-mono text-xs tabular-nums" title={p.accounts.join(", ")}>{p.accounts.slice(0, 2).join(", ")}{p.accounts.length > 2 ? ` +${p.accounts.length - 2}` : ""}</span>
                              : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td>
                            <Pill tone={STATUS[p.status].tone} dot={p.status !== "archived"}>{STATUS[p.status].label}</Pill>
                            {p.status === "frozen" && p.bannedReason && <div className="max-w-[16rem] whitespace-normal break-words text-2xs text-muted-foreground">{p.bannedReason}</div>}
                          </td>
                          <td className="whitespace-nowrap text-muted-foreground" title={p.seen ? fmtDate(p.seen, "shortDateTimeSeconds") : undefined}>{timeAgo(p.seen)}</td>
                          <td className="text-right tabular-nums">{p.trades30 || <span className="text-muted-foreground">0</span>}</td>
                          <td className="w-10 text-right">{menu(p)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </DataTable>
              )}
            </div>
          </Panel>
        </>
      )}

      <ReasonDialog state={dialog} onClose={() => setDialog(null)} busy={action.isPending || mapAccount.isPending} />
      <NameLatinDialog
        person={latinFor}
        busy={setLatin.isPending}
        onClose={() => setLatinFor(null)}
        onSave={(value) => latinFor && setLatin.mutate({ id: latinFor.id, nameLatin: value }, {
          onSuccess: (r) => { setLatinFor(null); refreshUsers(); toast({ title: r.nameLatin ? NL.saved(r.name) : NL.removed(r.name) }); },
          onError: (e) => toast({ title: e instanceof NotDeployedError ? "Нужен перезапуск API" : "Ошибка", description: e.message, variant: "destructive" }),
        })}
      />
      {legacy.dialog}
      <AddPersonDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        curators={curators}
        canAdmins={canAdmins}
        busy={create.isPending}
        onSubmit={(body) => create.mutate(body, {
          onSuccess: (u) => { setAddOpen(false); refreshUsers(); toast({ title: `Учётка ${u.name} создана`, description: "Передайте пароль лично — в аудит он не попадает." }); },
          onError: (e) => toast({ title: e instanceof NotDeployedError ? "Нужен перезапуск API" : "Ошибка", description: e instanceof NotDeployedError ? `${e.message} Пока можно создать учётку в «Настройки → Команда».` : e.message, variant: "destructive" }),
        })}
      />
    </div>
  );
}

function AccountMatchRow({ account, isNew, traders, onMap }: { account: string; isNew: boolean; traders: string[]; onMap: (account: string, trader: string) => void }) {
  const [trader, setTrader] = useState("");
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl bg-[var(--glass-bg)] p-3">
      <span className="font-mono text-sm tabular-nums">{account}</span>
      <Pill tone={isNew ? "warn" : "neutral"}>{isNew ? "новый в импорте" : "без трейдера"}</Pill>
      <div className="ml-auto flex items-center gap-2">
        <PersonSelect value={trader} onValueChange={setTrader} options={traders} placeholder="Чей счёт?" ariaLabel={`Трейдер для счёта ${account}`} className="h-9 w-[180px]" align="end" />
        <Button size="sm" disabled={!trader} onClick={() => onMap(account, trader)}>Привязать</Button>
      </div>
    </li>
  );
}

function NameLatinDialog({ person, busy, onClose, onSave }: { person: Person | null; busy: boolean; onClose: () => void; onSave: (value: string | null) => void }) {
  const [value, setValue] = useState("");
  useEffect(() => { if (person) setValue(person.nameLatin ?? ""); }, [person]);
  const trimmed = value.replace(/\s+/g, " ").trim();
  const changed = trimmed !== (person?.nameLatin ?? "");
  return (
    <Dialog open={!!person} onOpenChange={(v) => { if (!v && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => { e.preventDefault(); if (changed && !busy) onSave(trimmed || null); }} className="flex flex-col gap-4" autoComplete="off">
          <DialogHeader>
            <DialogTitle>{person ? NL.title(person.name) : ""}</DialogTitle>
            <DialogDescription>{NL.description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="nl-value" className="text-xs text-muted-foreground">{NL.label}</Label>
            <Input id="nl-value" value={value} onChange={(e) => setValue(e.target.value)} maxLength={80} placeholder={NL.placeholder} autoFocus spellCheck={false} />
          </div>
          <DialogFooter className="gap-2">
            {person?.nameLatin && <Button type="button" variant="ghost" className="mr-auto" disabled={busy} onClick={() => onSave(null)}>{NL.clear}</Button>}
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Отмена</Button>
            <Button type="submit" disabled={!changed || busy}>{busy ? "Сохраняю…" : NL.save}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BulkBar({
  count, curators, tiers, tierEligible, onClear, onAction, canManage,
}: {
  count: number;
  curators: string[];
  /** Tier ladder when the viewer may assign tiers (scaling.approve), else empty. */
  tiers: { key: string; name: string }[];
  /** Selected active traders — the only rows a tier applies to. */
  tierEligible: number;
  onClear: () => void;
  onAction: (kind: PeopleActionKind, opts?: { curator?: string | null; tierKey?: string }) => void;
  canManage: boolean;
}) {
  return (
    <div className="sticky-top flex flex-wrap items-center gap-2 rounded-xl border border-[var(--glass-border)] p-2" role="toolbar" aria-label="Действия с выбранными">
      <span className="px-2 text-sm font-medium tabular-nums">Выбрано: {count}</span>
      {canManage && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" size="sm"><UserCog /> Куратор</Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              {curators.map((c) => <DropdownMenuItem key={c} onSelect={() => onAction("curator", { curator: c })}>{c}</DropdownMenuItem>)}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onAction("curator", { curator: null })}>Без куратора</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={() => onAction("freeze")}><Snowflake /> Заморозить</Button>
          <Button variant="outline" size="sm" onClick={() => onAction("unfreeze")}><Sun /> Разморозить</Button>
          <Button variant="outline" size="sm" onClick={() => onAction("archive")}><Archive /> В архив</Button>
          <Button variant="outline" size="sm" onClick={() => onAction("restore")}><ArchiveRestore /> Вернуть</Button>
          <Button variant="outline" size="sm" onClick={() => onAction("sessions")}><LogOut /> Сбросить сессии</Button>
        </>
      )}
      {tiers.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={!tierEligible} title={tierEligible ? `Тир для ${tierEligible} активных трейдеров из выбранных` : "Тир назначается только активным трейдерам"}>
              <GraduationCap /> Тир{tierEligible && tierEligible !== count ? ` · ${tierEligible}` : ""}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel className="text-xs text-muted-foreground">Назначить тир ({tierEligible})</DropdownMenuLabel>
            {tiers.map((t) => <DropdownMenuItem key={t.key} onSelect={() => onAction("tier", { tierKey: t.key })}>{t.name}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Button variant="ghost" size="sm" className="ml-auto" onClick={onClear}><X /> Снять выделение</Button>
    </div>
  );
}

function AddPersonDialog({
  open, onOpenChange, curators, canAdmins, busy, onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  curators: string[];
  canAdmins: boolean;
  busy: boolean;
  onSubmit: (body: { name: string; password: string; role: string; curator: string | null; reason: string }) => void;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("trader");
  const [curator, setCurator] = useState("");
  const [reason, setReason] = useState("Новый сотрудник");
  useEffect(() => { if (open) { setName(""); setPassword(""); setRole("trader"); setCurator(""); setReason("Новый сотрудник"); } }, [open]);
  const minSecret = secretMinFor(role);
  const valid = name.trim().length > 0 && password.length >= minSecret && reason.trim().length >= 3;
  const submit = () => { if (valid && !busy) onSubmit({ name: name.trim(), password, role, curator: role === "trader" && curator ? curator : null, reason: reason.trim() }); };
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex flex-col gap-4" autoComplete="off">
          <DialogHeader>
            <DialogTitle>Новая учётка</DialogTitle>
            <DialogDescription>Создание попадёт в журнал аудита. Пароль в журнал не пишется.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="np-name" className="text-xs text-muted-foreground">Имя (как в журнале) <span className="text-down">*</span></Label>
              <Input id="np-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="np-pass" className="text-xs text-muted-foreground">Временный пароль <span className="text-down">*</span></Label>
              <Input id="np-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={authI18n.t("forced.tooShort", { min: minSecret })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Роль</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger aria-label="Роль"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="trader">Трейдер</SelectItem>
                    <SelectItem value="curator">Куратор</SelectItem>
                    {canAdmins && <SelectItem value="admin">Админ</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Куратор</Label>
                <Select value={curator || "__none"} onValueChange={(v) => setCurator(v === "__none" ? "" : v)} disabled={role !== "trader"}>
                  <SelectTrigger aria-label="Куратор"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Без куратора</SelectItem>
                    {curators.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="np-reason" className="text-xs text-muted-foreground">Причина <span className="text-down">*</span></Label>
              <Input id="np-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Отмена</Button>
            <Button type="submit" disabled={!valid || busy}>{busy ? "Создаю…" : "Создать"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
