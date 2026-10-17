import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Ban, BookOpen, CalendarCheck, Download, Flame, KeyRound, MoreHorizontal, Search, ShieldAlert, UserCheck, UserCog, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { QueryError } from "@/components/query-error";
import {
  DataTable, EmptyState, FilterChip, Kbd, Panel, Pill, ProgressRing, SortableTh, StatRow, useTableSort, type Tone,
} from "@/components/ds";
import { cn } from "@/lib/utils";
import { ActivityStrip } from "./ActivityStrip";
import { ROLE_LABEL, downloadCsv, isTypingTarget, timeAgo, type DeskPulse, type PulseUser } from "./api";
import { useUserActions } from "./useUserActions";
import { matchPerson, prepareQuery, usePeopleAliases } from "@/components/people/search";

export type TraderFilter = "all" | "traders" | "staff" | "nojournal" | "violations" | "stale" | "banned";

const FILTERS: { value: TraderFilter; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "traders", label: "Трейдеры" },
  { value: "staff", label: "Кураторы и админы" },
  { value: "nojournal", label: "Без журнала сегодня" },
  { value: "violations", label: "С нарушениями" },
  { value: "stale", label: "Не заходили 3+ дн" },
  { value: "banned", label: "Забанены" },
];

const STALE_MS = 3 * 86_400_000;
const isStale = (u: PulseUser) => !u.lastSeen || Date.now() - Date.parse(u.lastSeen) > STALE_MS;

function matches(u: PulseUser, f: TraderFilter) {
  switch (f) {
    case "traders": return u.role === "trader";
    case "staff": return u.role !== "trader";
    case "nojournal": return u.role === "trader" && !u.banned && !u.journalToday;
    case "violations": return u.violationsWeek > 0;
    case "stale": return !u.banned && isStale(u);
    case "banned": return u.banned;
    default: return true;
  }
}

const ACCESSORS = {
  name: (u: PulseUser) => u.name,
  lastSeen: (u: PulseUser) => (u.lastSeen ? Date.parse(u.lastSeen) : null),
  today: (u: PulseUser) => u.tradesToday,
  week: (u: PulseUser) => u.tradesWeek,
  streak: (u: PulseUser) => u.notesStreak,
  violations: (u: PulseUser) => u.violationsWeek * 1000 + u.violationsTotal,
};

const FILTER_KEY = "admin.traders.filter";

function roleTone(role: string): Tone {
  return role === "admin" ? "purple" : role === "curator" ? "accent" : "neutral";
}

export type RiskStatus = "breach" | "warn" | "ok" | "no_limits";

function RiskPill({ status }: { status: RiskStatus | undefined }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  if (status === "breach") return <Pill tone="down" dot>Лимит превышен</Pill>;
  if (status === "warn") return <Pill tone="warn" dot>Близко к лимиту</Pill>;
  if (status === "ok") return <Pill tone="up">В норме</Pill>;
  return <Pill tone="neutral">Без лимитов</Pill>;
}

function StatusPill({ u }: { u: PulseUser }) {
  if (u.banned) return <Pill tone="down" dot>Забанен</Pill>;
  if (!u.active) return <Pill tone="neutral">Неактивен</Pill>;
  if (u.activeToday) return <Pill tone="up" dot>Сегодня в работе</Pill>;
  if (isStale(u)) return <Pill tone="warn">Давно не заходил</Pill>;
  return <Pill tone="neutral">Не сегодня</Pill>;
}

function StreakCell({ u, journalAvailable }: { u: PulseUser; journalAvailable: boolean }) {
  if (!journalAvailable) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-flex items-center gap-1 font-semibold tabular-nums", u.notesStreak >= 3 ? "text-[hsl(var(--chart-3))]" : "text-foreground")}>
        {u.notesStreak >= 3 && <Flame className="h-3.5 w-3.5" aria-hidden="true" />}
        {u.notesStreak}
        <span className="sr-only"> дн подряд</span>
      </span>
      {u.journalToday
        ? <Pill tone="up" className="px-1.5">сегодня ✓</Pill>
        : u.role === "trader" && !u.banned ? <Pill tone="warn" className="px-1.5">нет записи</Pill> : null}
    </span>
  );
}

function ViolationsCell({ u, available }: { u: PulseUser; available: boolean }) {
  if (!available) return <span className="text-muted-foreground">—</span>;
  if (u.violationsTotal === 0) return <span className="text-muted-foreground tabular-nums">0</span>;
  return (
    <span className="inline-flex items-center justify-end gap-1.5 tabular-nums">
      {u.violationsWeek > 0
        ? <Pill tone={u.violationsHighWeek > 0 ? "down" : "warn"}>{u.violationsWeek} за 7д</Pill>
        : <span className="text-muted-foreground">0 за 7д</span>}
      <span className="text-xs text-muted-foreground">/ {u.violationsTotal}</span>
    </span>
  );
}

export function TradersTable({
  actor,
  isAdmin,
  pulse,
  isLoading,
  error,
  onRetry,
  onChange,
  filter: filterProp,
  onFilterChange,
  riskStatus,
}: {
  /** trader → risk-desk status; undefined when /api/risk/desk is unavailable (column hidden). */
  riskStatus?: Map<string, RiskStatus>;
  actor: string;
  isAdmin: boolean;
  pulse: DeskPulse | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  onChange: () => void;
  filter?: TraderFilter;
  onFilterChange?: (f: TraderFilter) => void;
}) {
  const [localFilter, setLocalFilter] = useState<TraderFilter>(() => {
    try { return (localStorage.getItem(FILTER_KEY) as TraderFilter) || "all"; } catch { return "all"; }
  });
  const filter = filterProp ?? localFilter;
  const setFilter = (f: TraderFilter) => {
    setLocalFilter(f);
    onFilterChange?.(f);
    try { localStorage.setItem(FILTER_KEY, f); } catch { /* ignore */ }
  };
  const [q, setQ] = useState("");
  const [openName, setOpenName] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const actions = useUserActions(actor, onChange);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !isTypingTarget(e.target) && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const users = pulse?.users ?? [];
  const counts = useMemo(() => {
    const c = {} as Record<TraderFilter, number>;
    for (const f of FILTERS) c[f.value] = users.filter((u) => matches(u, f.value)).length;
    return c;
  }, [users]);
  const aliases = usePeopleAliases();
  const filtered = useMemo(() => {
    const pq = prepareQuery(q);
    return users.filter((u) => matches(u, filter) && (pq.empty || matchPerson(pq, u.name, aliases)));
  }, [users, filter, q, aliases]);
  const { rows, thProps } = useTableSort(filtered, ACCESSORS, "lastSeen");
  const open = openName ? users.find((u) => u.name === openName) ?? null : null;

  const exportCsv = () => {
    downloadCsv(
      ["Имя", "Роль", "Статус", "Последний визит", "Сделок сегодня", "Сделок за 7д", "Последний день сделок", "Журнал сегодня", "Серия журнала", "Журнал за 30д", "Нарушений сегодня", "Нарушений за 7д", "Нарушений всего"],
      rows.map((u) => [
        u.name, ROLE_LABEL[u.role] ?? u.role, u.banned ? "забанен" : u.active ? "активен" : "неактивен",
        u.lastSeen ?? "", u.tradesToday, u.tradesWeek, u.lastTradeDate ?? "", u.journalToday ? "да" : "нет",
        u.notesStreak, u.journal30, u.violationsToday, u.violationsWeek, u.violationsTotal,
      ]),
      `desk-activity-${pulse?.date ?? "today"}.csv`,
    );
  };

  const menu = (u: PulseUser) => {
    const isSelf = u.name === actor;
    const canTouch = isAdmin || u.role !== "admin";
    const canBan = !isSelf && u.role !== "admin" && (isAdmin || u.role !== "curator");
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 data-[state=open]:opacity-100"
            aria-label={`Действия: ${u.name}`}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuLabel className="text-xs text-muted-foreground">{u.name}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => setOpenName(u.name)}><UserCog /> Карточка трейдера</DropdownMenuItem>
          {canTouch && <DropdownMenuItem onSelect={() => actions.setPassword(u)}><KeyRound /> Задать пароль</DropdownMenuItem>}
          {canTouch && !isSelf && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><Users /> Роль: {ROLE_LABEL[u.role] ?? u.role}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={u.role} onValueChange={(role) => { if (role !== u.role) actions.changeRole(u, role); }}>
                  {(isAdmin ? (["trader", "curator", "admin"] as const) : (["trader", "curator"] as const)).map((r) => (
                    <DropdownMenuRadioItem key={r} value={r}>{ROLE_LABEL[r]}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />
          {u.banned ? (
            <DropdownMenuItem onSelect={() => actions.unban(u)}><UserCheck /> Разбанить</DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled={!canBan} onSelect={() => actions.ban(u)} className="text-down focus:text-down">
              <Ban /> {canBan ? "Забанить…" : isSelf ? "Нельзя забанить себя" : "Бан недоступен"}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const days = pulse?.days ?? [];
  const journalAvailable = pulse?.journalAvailable ?? false;
  const violationsAvailable = pulse?.violationsAvailable ?? false;

  return (
    <Panel
      title="Активность команды"
      description={pulse ? `Сегодня ${pulse.date} · полоса — сделки за 14 дней, точка — запись в журнале` : undefined}
      icon={Users}
      actions={
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
          <Download /> CSV
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative w-full lg:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); (e.target as HTMLInputElement).blur(); } }}
              placeholder="Поиск по имени"
              aria-label="Поиск по имени"
              className="pl-9 pr-10"
            />
            <Kbd className="absolute right-3 top-1/2 -translate-y-1/2">/</Kbd>
          </div>
          <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1" role="group" aria-label="Фильтр пользователей">
            {FILTERS.map((f) => (
              <FilterChip key={f.value} active={filter === f.value} onClick={() => setFilter(f.value)} count={counts[f.value]} className="shrink-0">
                {f.label}
              </FilterChip>
            ))}
          </div>
        </div>

        {error ? (
          <QueryError error={error} onRetry={onRetry} />
        ) : isLoading ? (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label="Загрузка">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={users.length === 0 ? "Пользователей нет" : "Никого по этому фильтру"}
            description={users.length === 0 ? "Создать учётку можно в «Настройках»." : "Смените фильтр или очистите поиск."}
            action={users.length > 0 ? <Button variant="outline" size="sm" onClick={() => { setQ(""); setFilter("all"); }}>Показать всех</Button> : undefined}
          />
        ) : (
          <>
            {/* Desktop table */}
            <DataTable className="hidden md:block" maxHeight="65vh" ariaLabel="Таблица активности команды">
              <table>
                <thead>
                  <tr>
                    <SortableTh {...thProps("name")}>Трейдер</SortableTh>
                    <SortableTh {...thProps("lastSeen")}>Последний визит</SortableTh>
                    <SortableTh {...thProps("today")} align="right">Сегодня</SortableTh>
                    <SortableTh {...thProps("week")} align="right">За 7 дней</SortableTh>
                    <th scope="col">14 дней</th>
                    {riskStatus && <th scope="col">Риск</th>}
                    <SortableTh {...thProps("streak")}>Серия журнала</SortableTh>
                    <SortableTh {...thProps("violations")} align="right">Нарушения</SortableTh>
                    <th scope="col"><span className="sr-only">Действия</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => (
                    <tr
                      key={u.id}
                      tabIndex={0}
                      onClick={() => setOpenName(u.name)}
                      onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) setOpenName(u.name); }}
                      className={cn("group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", u.banned && "opacity-70")}
                    >
                      <td>
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-medium text-foreground">{u.name}</span>
                          {u.name === actor && <span className="text-2xs text-muted-foreground">(вы)</span>}
                          {u.role !== "trader" && <Pill tone={roleTone(u.role)}>{ROLE_LABEL[u.role] ?? u.role}</Pill>}
                          {u.banned && <Pill tone="down">бан</Pill>}
                        </div>
                      </td>
                      <td>
                        <span className={cn("whitespace-nowrap", u.activeToday ? "text-foreground" : isStale(u) && !u.banned ? "text-[hsl(var(--chart-3))]" : "text-muted-foreground")} title={u.lastSeen ? new Date(u.lastSeen).toLocaleString("ru-RU") : undefined}>
                          {u.activeToday && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-up align-middle" aria-hidden="true" />}
                          {timeAgo(u.lastSeen)}
                        </span>
                      </td>
                      <td className="text-right font-semibold tabular-nums">{u.tradesToday || <span className="font-normal text-muted-foreground">0</span>}</td>
                      <td className="text-right tabular-nums">{u.tradesWeek}</td>
                      <td><ActivityStrip days={days} trades={u.tradeStrip} journal={journalAvailable ? u.journalStrip : undefined} size="sm" /></td>
                      {riskStatus && <td><RiskPill status={riskStatus.get(u.name)} /></td>}
                      <td><StreakCell u={u} journalAvailable={journalAvailable} /></td>
                      <td className="text-right"><ViolationsCell u={u} available={violationsAvailable} /></td>
                      <td className="w-10 text-right">{menu(u)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTable>

            {/* Mobile cards */}
            <ul className="flex flex-col gap-2 md:hidden">
              {rows.map((u) => (
                <li key={u.id} className="glass-panel group flex flex-col gap-2 rounded-xl p-3">
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" onClick={() => setOpenName(u.name)} className="min-w-0 text-left">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate font-medium">{u.name}</span>
                        {u.role !== "trader" && <Pill tone={roleTone(u.role)}>{ROLE_LABEL[u.role] ?? u.role}</Pill>}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{timeAgo(u.lastSeen)}</div>
                    </button>
                    <div className="flex items-center gap-1"><StatusPill u={u} />{menu(u)}</div>
                  </div>
                  <ActivityStrip days={days} trades={u.tradeStrip} journal={journalAvailable ? u.journalStrip : undefined} />
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <span><span className="text-muted-foreground">Сегодня </span><b className="tabular-nums">{u.tradesToday}</b></span>
                    <span><span className="text-muted-foreground">7д </span><b className="tabular-nums">{u.tradesWeek}</b></span>
                    <StreakCell u={u} journalAvailable={journalAvailable} />
                    {violationsAvailable && u.violationsWeek > 0 && <Pill tone="warn">{u.violationsWeek} наруш. за 7д</Pill>}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <TraderSheet
        user={open}
        days={days}
        journalAvailable={journalAvailable}
        violationsAvailable={violationsAvailable}
        actor={actor}
        isAdmin={isAdmin}
        onClose={() => setOpenName(null)}
        actions={actions}
        risk={open && riskStatus ? riskStatus.get(open.name) ?? null : undefined}
      />
      {actions.dialog}
    </Panel>
  );
}

function TraderSheet({
  user: u,
  days,
  journalAvailable,
  violationsAvailable,
  actor,
  isAdmin,
  onClose,
  actions,
  risk,
}: {
  risk?: RiskStatus | null;
  user: PulseUser | null;
  days: string[];
  journalAvailable: boolean;
  violationsAvailable: boolean;
  actor: string;
  isAdmin: boolean;
  onClose: () => void;
  actions: ReturnType<typeof useUserActions>;
}) {
  const isSelf = u?.name === actor;
  const canBan = !!u && !isSelf && u.role !== "admin" && (isAdmin || u.role !== "curator");
  const canTouch = !!u && (isAdmin || u.role !== "admin");
  // ~21 trading days in 30 calendar days.
  const journalPct = u ? Math.min(1, u.journal30 / 21) : 0;
  return (
    <Sheet open={!!u} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        {u && (
          <>
            <SheetHeader className="gap-2 border-b border-[var(--glass-border)] p-5 text-left">
              <div className="flex flex-wrap items-center gap-2">
                <SheetTitle className="text-lg">{u.name}</SheetTitle>
                <Pill tone={roleTone(u.role)}>{ROLE_LABEL[u.role] ?? u.role}</Pill>
                <StatusPill u={u} />
              </div>
              <SheetDescription>
                Последний визит: {timeAgo(u.lastSeen)}{u.lastSeen ? ` · ${new Date(u.lastSeen).toLocaleString("ru-RU")}` : ""}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-5 p-5">
              {u.banned && (
                <div className="flex items-start gap-2 rounded-xl bg-down/10 p-3 text-sm text-down">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>Забанен{u.bannedReason ? `: ${u.bannedReason}` : ""}</span>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <div className="glass-panel rounded-xl p-3">
                  <div className="text-xs text-muted-foreground">Сегодня</div>
                  <div className="text-2xl font-semibold tabular-nums">{u.tradesToday}</div>
                  <div className="text-2xs text-muted-foreground">сделок</div>
                </div>
                <div className="glass-panel rounded-xl p-3">
                  <div className="text-xs text-muted-foreground">За 7 дней</div>
                  <div className="text-2xl font-semibold tabular-nums">{u.tradesWeek}</div>
                  <div className="text-2xs text-muted-foreground">сделок</div>
                </div>
                <div className="glass-panel flex flex-col items-center justify-center rounded-xl p-3">
                  <ProgressRing value={journalPct * 100} tone={journalPct >= 0.8 ? "up" : journalPct >= 0.4 ? "warn" : "down"} label={u.journal30} ariaLabel={`Журнал за 30 дней: ${u.journal30} дн`} />
                  <div className="mt-1 text-2xs text-muted-foreground">журнал 30д</div>
                </div>
              </div>

              <section className="flex flex-col gap-2">
                <h3 className="micro-label">Последние 14 дней</h3>
                <ActivityStrip days={days} trades={u.tradeStrip} journal={journalAvailable ? u.journalStrip : undefined} />
              </section>

              <section className="flex flex-col">
                <h3 className="micro-label mb-1">Дисциплина</h3>
                {risk !== undefined && <StatRow label="Риск-лимиты сегодня" value={<RiskPill status={risk ?? undefined} />} />}
                <StatRow label="Последний день со сделками" value={u.lastTradeDate ?? "—"} />
                {journalAvailable && <StatRow label="Журнал сегодня" value={u.journalToday ? "заполнен" : "нет записи"} tone={u.journalToday ? "up" : u.role === "trader" ? "warn" : "neutral"} />}
                {journalAvailable && <StatRow label="Серия журнала" value={`${u.notesStreak} дн`} />}
                {violationsAvailable && (
                  <>
                    <StatRow label="Нарушений сегодня" value={u.violationsToday} tone={u.violationsToday > 0 ? "down" : "neutral"} />
                    <StatRow label="Нарушений за 7 дней" value={`${u.violationsWeek}${u.violationsHighWeek ? ` (${u.violationsHighWeek} высокой важности)` : ""}`} tone={u.violationsWeek > 0 ? "warn" : "neutral"} />
                    <StatRow label="Нарушений всего" value={u.violationsTotal} />
                  </>
                )}
                <StatRow label="В команде с" value={u.createdAt ? new Date(u.createdAt).toLocaleDateString("ru-RU") : "—"} />
              </section>

              <section className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm"><Link href="/journal"><BookOpen /> Журнал</Link></Button>
                <Button asChild variant="outline" size="sm"><Link href="/error-tracker"><CalendarCheck /> Правила и нарушения</Link></Button>
                <Button asChild variant="outline" size="sm"><Link href="/ratings"><Flame /> Рейтинги</Link></Button>
              </section>

              <section className="flex flex-col gap-2 border-t border-[var(--glass-border)] pt-4">
                <h3 className="micro-label">Управление</h3>
                <div className="flex flex-wrap gap-2">
                  {canTouch && <Button variant="outline" size="sm" onClick={() => actions.setPassword(u)}><KeyRound /> Пароль</Button>}
                  {canTouch && !isSelf && (isAdmin ? (["trader", "curator", "admin"] as const) : (["trader", "curator"] as const)).filter((r) => r !== u.role).map((r) => (
                    <Button key={r} variant="outline" size="sm" onClick={() => actions.changeRole(u, r)}><UserCog /> Сделать: {ROLE_LABEL[r].toLowerCase()}</Button>
                  ))}
                  {u.banned ? (
                    <Button variant="outline" size="sm" onClick={() => actions.unban(u)}><UserCheck /> Разбанить</Button>
                  ) : (
                    <Button variant="destructive" size="sm" disabled={!canBan} onClick={() => actions.ban(u)}><Ban /> Забанить</Button>
                  )}
                </div>
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
