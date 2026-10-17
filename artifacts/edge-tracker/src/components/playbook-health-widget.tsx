import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { BASE } from "@/lib/api";
import { HeartPulse, ChevronDown, ArrowRight, BellOff, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { FilterChip, Pill, type Tone } from "@/components/ds";
import { Ring, plural, lsGet, lsSet } from "@/components/playbook-sub/bits";

type HealthRow = {
  id: number; name: string; folder: string | null; confidenceLevel: number | null;
  parentId: number | null; tradeCount: number; wins: number;
  lastTradeAt: string | null; days?: number | null; winrate?: number;
};

type HealthResponse = {
  trader: string | null;
  /** Desk win rate W / (W + L); null until the desk has decided trades. */
  globalWinrate: number | null;
  staleAfterDays?: number;
  untestedGraceDays?: number;
  stale: HealthRow[];
  /** Never traded, older than the grace period, checklist not run recently. */
  untested: (HealthRow & { ageDays?: number })[];
  lowSampleHighConf: HealthRow[];
  underperforming: HealthRow[];
  /* new API (playbook_examples): */
  noExamples?: (HealthRow & { exampleCount?: number })[];
  noTier1?: (HealthRow & { exampleCount?: number })[];
  idle?: HealthRow[];
  idleAfterDays?: number;
};

/** Minimal shape of /api/playbook entries (same query key as the page → shared cache). */
type EntryLite = {
  id: number; name: string; folder: string | null; trader?: string | null; parentId?: number | null;
  checklist?: string | null; checklistItems?: unknown[] | null;
  screenshots?: unknown[] | null; screenshotUrl?: string | null;
  conditions?: string | null;
};

type IssueKey = "under" | "overconf" | "noChecklist" | "noRules" | "noExamples" | "noTier1" | "idle" | "stale" | "noTrades";

const ISSUES: Record<IssueKey, { label: string; action: string; tone: Tone; weight: number }> = {
  under:       { label: "Винрейт ниже среднего", action: "Пересмотреть условия входа", tone: "down", weight: 50 },
  overconf:    { label: "Уверенность без данных", action: "Снизить уверенность или набрать выборку", tone: "warn", weight: 30 },
  noRules:     { label: "Нет условий входа", action: "Описать, когда торговать сетап", tone: "warn", weight: 25 },
  noChecklist: { label: "Нет чек-листа", action: "Добавить чек-лист перед входом", tone: "warn", weight: 20 },
  noExamples:  { label: "Нет эталонов", action: "Добавить примеры сделок (Tier 1/2/3)", tone: "neutral", weight: 10 },
  noTier1:     { label: "Нет Tier 1", action: "Отметить эталонную сделку как Tier 1", tone: "neutral", weight: 8 },
  idle:        { label: "Не торговался 30+ дней", action: "Проверить, актуален ли сетап", tone: "neutral", weight: 7 },
  stale:       { label: "Давно не торговался", action: "Проверить актуальность", tone: "neutral", weight: 6 },
  noTrades:    { label: "Не проверен в рынке", action: "Привязать сделки или архивировать", tone: "neutral", weight: 4 },
};
const ORDER: IssueKey[] = ["under", "overconf", "noRules", "noChecklist", "noExamples", "noTier1", "idle", "stale", "noTrades"];

type Task = {
  id: number; name: string; folder: string | null;
  issues: { key: IssueKey; detail?: string }[];
  score: number;
};

const SNOOZE_KEY = "pb-health-snooze";
const SNOOZE_DAYS = 14;
const PAGE = 6;

export function PlaybookHealthWidget({ onJump, defaultOpen }: { onJump?: (id: number) => void; defaultOpen?: boolean }) {
  const { user } = useAuth();
  // The API scopes trades by the session (traders see only their own); the key just separates caches per viewer.
  const userKey = user?.role === "trader" && user.traderName ? user.traderName : null;
  const [open, setOpen] = useState<boolean>(() => defaultOpen ?? lsGet("pb-health-open", false));
  const [filter, setFilter] = useState<IssueKey | "all">("all");
  const [limit, setLimit] = useState(PAGE);
  const [snoozed, setSnoozed] = useState<Record<string, number>>(() => lsGet(SNOOZE_KEY, {}));

  const { data } = useQuery<HealthResponse>({
    queryKey: ["playbook-health", userKey],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/playbook/health`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  const { data: entries } = useQuery<EntryLite[]>({
    queryKey: ["playbook"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/playbook`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  const valid = !!data && Array.isArray(data.stale) && Array.isArray(data.lowSampleHighConf) && Array.isArray(data.underperforming);

  const { tasks, totalSetups } = useMemo(() => {
    const map = new Map<number, Task>();
    const add = (id: number, name: string, folder: string | null, key: IssueKey, detail?: string) => {
      let t = map.get(id);
      if (!t) { t = { id, name, folder, issues: [], score: 0 }; map.set(id, t); }
      if (t.issues.some((i) => i.key === key)) return;
      t.issues.push({ key, detail });
      t.score += ISSUES[key].weight;
    };
    if (valid && data) {
      for (const r of data.underperforming) add(r.id, r.name, r.folder, "under", `${Math.round((r.winrate ?? 0) * 100)}% vs ${Math.round((data.globalWinrate ?? 0) * 100)}% · n=${r.tradeCount}`);
      for (const r of data.lowSampleHighConf) add(r.id, r.name, r.folder, "overconf", `${r.confidenceLevel ?? 0}% при n=${r.tradeCount}`);
      for (const r of data.stale) {
        if (r.tradeCount === 0) add(r.id, r.name, r.folder, "noTrades");
        else add(r.id, r.name, r.folder, "stale", r.days != null ? `${r.days} дн.` : undefined);
      }
      for (const r of Array.isArray(data.untested) ? data.untested : []) add(r.id, r.name, r.folder, "noTrades", r.ageDays != null ? `${r.ageDays} дн. с создания` : undefined);
      for (const r of Array.isArray(data.noExamples) ? data.noExamples : []) add(r.id, r.name, r.folder, "noExamples");
      for (const r of Array.isArray(data.noTier1) ? data.noTier1 : []) add(r.id, r.name, r.folder, "noTier1", r.exampleCount ? `эталонов ${r.exampleCount}` : undefined);
      for (const r of Array.isArray(data.idle) ? data.idle : []) add(r.id, r.name, r.folder, "idle", r.days != null ? `${r.days} дн.` : undefined);
    }
    const serverExamples = valid && Array.isArray(data?.noExamples);
    const list = (Array.isArray(entries) ? entries : []).filter((e) => !userKey || !e.trader || e.trader === userKey);
    for (const e of list) {
      const hasChecklist = (Array.isArray(e.checklistItems) && e.checklistItems.length > 0) || !!e.checklist?.trim();
      const hasExamples = (Array.isArray(e.screenshots) && e.screenshots.length > 0) || !!e.screenshotUrl?.trim();
      // Children inherit checklist/conditions from parent — don't nag about them.
      if (!e.parentId) {
        if (!e.conditions?.trim()) add(e.id, e.name, e.folder, "noRules");
        if (!hasChecklist) add(e.id, e.name, e.folder, "noChecklist");
      }
      // Older API: "examples" = screenshots on the setup.
      if (!serverExamples && !hasExamples) add(e.id, e.name, e.folder, "noExamples");
    }
    const now = Date.now();
    const all = [...map.values()]
      .filter((t) => !(snoozed[t.id] && snoozed[t.id] > now))
      .map((t) => ({ ...t, issues: t.issues.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key)) }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ru"));
    return { tasks: all, totalSetups: list.length };
  }, [data, entries, valid, userKey, snoozed]);

  // Secondary widget: stay silent while loading / on error.
  if (!valid && !Array.isArray(entries)) return null;
  if (tasks.length === 0 && Object.keys(snoozed).length === 0) return null;

  const counts = ORDER.reduce((acc, k) => { acc[k] = tasks.filter((t) => t.issues.some((i) => i.key === k)).length; return acc; }, {} as Record<IssueKey, number>);
  const visible = filter === "all" ? tasks : tasks.filter((t) => t.issues.some((i) => i.key === filter));
  const critical = counts.under + counts.overconf;
  // "Needs attention" = has at least one important issue (weight ≥ 20); examples / no trades / stale are minor.
  const important = tasks.filter((t) => t.issues.some((i) => ISSUES[i.key].weight >= 20)).length;
  const minor = tasks.length - important;
  const healthy = totalSetups > 0 ? Math.max(0, totalSetups - important) : 0;
  const healthPct = totalSetups > 0 ? healthy / totalSetups : 0;
  const snoozedCount = Object.values(snoozed).filter((until) => until > Date.now()).length;

  function toggleOpen() {
    setOpen((v) => { lsSet("pb-health-open", !v); return !v; });
  }
  function snooze(id: number) {
    const next = { ...snoozed, [id]: Date.now() + SNOOZE_DAYS * 86400000 };
    setSnoozed(next);
    lsSet(SNOOZE_KEY, next);
  }
  function unsnoozeAll() {
    setSnoozed({});
    lsSet(SNOOZE_KEY, {});
  }

  return (
    <section className="glass-panel rounded-2xl" aria-label="Здоровье плейбука">
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5"
      >
        <Ring value={healthPct} size={36} stroke={4} tone={healthPct >= 0.7 ? "up" : healthPct >= 0.4 ? "warn" : "down"} label={`В порядке ${Math.round(healthPct * 100)}% сетапов`}>
          <HeartPulse className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </Ring>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">Здоровье плейбука</div>
          <div className="text-xs text-muted-foreground">
            {tasks.length === 0
              ? "Все сетапы в порядке"
              : important === 0
                ? <>Критичных проблем нет · {minor} {plural(minor, "мелкая доработка", "мелкие доработки", "мелких доработок")}</>
                : <>{important} {plural(important, "сетап требует", "сетапа требуют", "сетапов требуют")} внимания{totalSetups > 0 && <> · в порядке {healthy} из {totalSetups}</>}</>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {critical > 0 && <Pill tone="down" dot>{critical} важно</Pill>}
          {counts.noChecklist + counts.noRules > 0 && <Pill tone="warn">{counts.noChecklist + counts.noRules} без правил</Pill>}
          {counts.noExamples > 0 && <Pill tone="neutral" className="hidden sm:inline-flex">{counts.noExamples} без эталонов</Pill>}
          {counts.idle > 0 && <Pill tone="neutral" className="hidden xl:inline-flex">{counts.idle} не торговались 30+ дн.</Pill>}
        </div>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground motion-safe:transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>

      {open && (
        <div className="space-y-3 border-t border-[var(--glass-border)] px-4 pb-4 pt-3 sm:px-5">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Фильтр задач">
            <FilterChip active={filter === "all"} onClick={() => { setFilter("all"); setLimit(PAGE); }} count={tasks.length}>Все</FilterChip>
            {ORDER.filter((k) => counts[k] > 0).map((k) => (
              <FilterChip key={k} active={filter === k} onClick={() => { setFilter(k); setLimit(PAGE); }} count={counts[k]}>
                {ISSUES[k].label}
              </FilterChip>
            ))}
          </div>

          {visible.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Здесь пусто — всё сделано.</p>
          ) : (
            <ol className="space-y-1.5">
              {visible.slice(0, limit).map((t, i) => {
                const top = filter === "all" ? t.issues[0] : t.issues.find((x) => x.key === filter) ?? t.issues[0];
                return (
                  <li key={t.id} className="group flex items-start gap-3 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2.5">
                    <span className="mt-0.5 w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="truncate text-sm font-medium text-foreground">{t.name}</span>
                        {t.folder && <span className="truncate text-xs text-muted-foreground">{t.folder}</span>}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">→ {ISSUES[top.key].action}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {t.issues.map((x) => (
                          <Pill key={x.key} tone={ISSUES[x.key].tone}>
                            {ISSUES[x.key].label}{x.detail ? ` · ${x.detail}` : ""}
                          </Pill>
                        ))}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => snooze(t.id)}
                        aria-label={`Скрыть «${t.name}» на ${SNOOZE_DAYS} дней`}
                        title={`Скрыть на ${SNOOZE_DAYS} дней`}
                        className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <BellOff className="h-4 w-4" aria-hidden="true" />
                      </button>
                      {onJump && (
                        <button
                          type="button"
                          onClick={() => onJump(t.id)}
                          className="inline-flex min-h-8 items-center gap-1 rounded-full px-3 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          Открыть <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            {visible.length > limit ? (
              <button
                type="button"
                onClick={() => setLimit((l) => l + PAGE * 2)}
                className="inline-flex min-h-8 items-center rounded-full px-3 text-xs font-medium text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Показать ещё {Math.min(PAGE * 2, visible.length - limit)} · осталось {visible.length - limit}
              </button>
            ) : <span />}
            {snoozedCount > 0 && (
              <button
                type="button"
                onClick={unsnoozeAll}
                className="inline-flex min-h-8 items-center gap-1 rounded-full px-3 text-xs text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Вернуть скрытые ({snoozedCount})
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
