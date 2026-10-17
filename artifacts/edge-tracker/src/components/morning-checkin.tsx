import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sun, Pencil, Moon, Target, Check, Flame, ChevronDown, ChevronUp, type LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ds";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { addDays, nyDate } from "@/lib/trading-date";
import { BASE } from "@/lib/api";
import { cn } from "@/lib/utils";
import { WidgetShell, IconAction, WidgetError, Sparkline, MiniStat, fmtR } from "@/components/widgets/widget-kit";
import {
  type CheckinFlags,
  type CheckinRow,
  type CheckinInsights,
  readiness,
  readinessTone,
  readinessLabel,
  FLAG_LABEL,
  NEGATIVE_FLAGS,
} from "@/components/widgets/checkin-model";

type Draft = {
  sleep: boolean | null;
  focus: boolean | null;
  stressed: boolean;
  anxious: boolean;
  tilted: boolean;
  revenge: boolean;
  plan: string;
};

const EMPTY: Draft = { sleep: null, focus: null, stressed: false, anxious: false, tilted: false, revenge: false, plan: "" };

function draftToFlags(d: Draft): CheckinFlags {
  return {
    sleepWell: d.sleep === true,
    focused: d.focus === true,
    stressed: d.stressed,
    anxious: d.anxious,
    tilted: d.tilted,
    revenge: d.revenge,
  };
}

function rowToDraft(r: CheckinRow): Draft {
  return {
    sleep: !!r.sleepWell,
    focus: !!r.focused,
    stressed: !!r.stressed,
    anxious: !!r.anxious,
    tilted: !!r.tilted,
    revenge: !!r.revenge,
    plan: r.freeText ?? "",
  };
}

const TONE_ACTIVE = {
  up: "border-transparent bg-up/15 text-up",
  down: "border-transparent bg-down/15 text-down",
  accent: "border-transparent bg-primary/15 text-primary",
} as const;

function Choice({
  active,
  tone,
  icon: Icon,
  children,
  onClick,
}: {
  active: boolean;
  tone: keyof typeof TONE_ACTIVE;
  icon?: LucideIcon;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? TONE_ACTIVE[tone]
          : "border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground",
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      {children}
      {active && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
    </button>
  );
}

function Step({ n, label, done, children }: { n: number; label: string; done: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex w-28 shrink-0 items-center gap-2">
        <span
          className={cn(
            "grid h-5 w-5 place-items-center rounded-full text-2xs font-semibold tabular-nums transition-colors",
            done ? "bg-primary text-primary-foreground" : "bg-foreground/10 text-muted-foreground",
          )}
          aria-hidden="true"
        >
          {done ? <Check className="h-3 w-3" /> : n}
        </span>
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

/** Ring gauge 0..100 for readiness. */
function ReadinessRing({ score, size = 44 }: { score: number; size?: number }) {
  const tone = readinessTone(score);
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const color = tone === "up" ? "hsl(var(--up))" : tone === "warn" ? "hsl(var(--chart-3))" : "hsl(var(--down))";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`Готовность ${score} из 100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--foreground) / 0.08)" strokeWidth={4} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * c} ${c}`}
          className="motion-safe:transition-[stroke-dasharray] motion-safe:duration-300"
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-semibold tabular-nums">{score}</span>
    </div>
  );
}

function pctOrDash(v: number | null) {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

/** Correlation block: how readiness / flags relate to results over the last 30 days. */
function Correlation({ data }: { data: CheckinInsights }) {
  const { highReadiness: hi, lowReadiness: lo, flags } = data;
  const enough = hi.trades + lo.trades >= 3;

  const worstFlag = useMemo(() => {
    let best: { key: keyof CheckinFlags; delta: number } | null = null;
    for (const f of flags) {
      if (!(NEGATIVE_FLAGS as readonly string[]).includes(f.key)) continue;
      if (f.with.trades < 2 || f.without.trades < 2 || f.with.winRate == null || f.without.winRate == null) continue;
      const delta = Math.round((f.with.winRate - f.without.winRate) * 100);
      if (delta < 0 && (!best || delta < best.delta)) best = { key: f.key, delta };
    }
    return best;
  }, [flags]);

  if (!enough) {
    return (
      <p className="text-xs text-muted-foreground">
        Связь с результатом появится, когда наберётся несколько дней с чек-ином и сделками
        {data.overall.days > 0 ? ` (сейчас дней с чек-ином: ${data.overall.days}).` : "."}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <MiniStat
          label="Готовность ≥ 70"
          value={pctOrDash(hi.winRate)}
          tone={hi.winRate != null && lo.winRate != null && hi.winRate > lo.winRate ? "up" : "neutral"}
          hint={`${hi.trades} сд. · ${fmtR(hi.avgR)}`}
        />
        <MiniStat
          label="Готовность < 50"
          value={pctOrDash(lo.winRate)}
          tone={hi.winRate != null && lo.winRate != null && lo.winRate < hi.winRate ? "down" : "neutral"}
          hint={`${lo.trades} сд. · ${fmtR(lo.avgR)}`}
        />
      </div>
      {worstFlag && (
        <p className="text-xs text-muted-foreground">
          Сильнее всего мешает <span className="font-medium text-down">«{FLAG_LABEL[worstFlag.key]}»</span>:{" "}
          <span className="tabular-nums text-down">−{Math.abs(worstFlag.delta)} п.п.</span> винрейта.
        </p>
      )}
    </div>
  );
}

export function MorningCheckin() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const userId = user?.traderName ?? null;
  // Trading day = America/New_York date (not the browser's local day): a check-in belongs to the desk's day.
  const today = nyDate();

  const todayQ = useQuery<CheckinRow | null>({
    queryKey: ["emotional-state-today", userId, today],
    // Pass the NY trading date explicitly: the server's default (UTC) day differs around midnight.
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/emotional-state/today?userId=${encodeURIComponent(userId!)}&date=${today}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!userId,
    staleTime: 60_000,
    retry: 1,
  });

  const insightsQ = useQuery<CheckinInsights>({
    queryKey: ["emotional-insights", userId, today],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/emotional-state/insights?userId=${encodeURIComponent(userId!)}&to=${today}&days=30`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!userId,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const saved = todayQ.data ?? null;
  const [editing, setEditing] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem("checkin_snooze") === today;
    } catch {
      return false;
    }
  });
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [submitting, setSubmitting] = useState(false);

  // Prefill so "Изменить" edits the saved check-in instead of a blank one.
  useEffect(() => {
    if (saved) setDraft(rowToDraft(saved));
  }, [saved]);

  const flags = draftToFlags(draft);
  const score = readiness(flags);
  const calm = !draft.stressed && !draft.anxious && !draft.tilted && !draft.revenge;
  const ready = draft.sleep != null && draft.focus != null;

  const snooze = (v: boolean) => {
    setCollapsed(v);
    try {
      if (v) window.localStorage.setItem("checkin_snooze", today);
      else window.localStorage.removeItem("checkin_snooze");
    } catch {
      /* storage blocked */
    }
  };

  async function submit() {
    if (!userId || !ready || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/emotional-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, date: today, ...flags, freeText: draft.plan.trim() || null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const row = (await res.json()) as CheckinRow;
      qc.setQueryData(["emotional-state-today", userId, today], row);
      qc.invalidateQueries({ queryKey: ["emotional-insights", userId] });
      setEditing(false);
      toast({ title: "Чек-ин сохранён", description: `Готовность ${score}/100 · ${readinessLabel(score)}` });
    } catch (e) {
      toast({ title: "Ошибка чек-ина", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  const insights = insightsQ.data;
  // 14 calendar days ending today; days without a check-in are skipped (line connects across them).
  const spark = useMemoSpark(insights?.days ?? [], today);
  const streak = insights?.streak ?? 0;

  if (!userId) return null;

  if (todayQ.isLoading) {
    return (
      <div className="glass-panel rounded-2xl p-4" aria-busy="true" aria-label="Загрузка чек-ина">
        <div className="flex items-center gap-3">
          <Skeleton className="h-11 w-11 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
        </div>
      </div>
    );
  }

  /* ───────── Done: compact summary ───────── */
  if (saved && !editing) {
    const savedScore = saved.readiness ?? readiness(saved);
    const tone = readinessTone(savedScore);
    const activeFlags = (Object.keys(FLAG_LABEL) as Array<keyof CheckinFlags>).filter((k) => saved[k]);
    return (
      <WidgetShell
        icon={Sun}
        title="Утренний чек-ин"
        meta={streak > 1 ? `серия ${streak} дн.` : undefined}
        accent={tone}
        actions={<IconAction icon={Pencil} label="Изменить чек-ин" onClick={() => setEditing(true)} />}
      >
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 items-start gap-3">
            <ReadinessRing score={savedScore} />
            <div className="min-w-0 space-y-1.5">
              <div className="text-sm font-semibold text-foreground">{readinessLabel(savedScore)}</div>
              <div className="flex flex-wrap gap-1">
                {activeFlags.length === 0 ? (
                  <Pill tone="neutral">Без отметок</Pill>
                ) : (
                  activeFlags.map((k) => (
                    <Pill key={k} tone={(NEGATIVE_FLAGS as readonly string[]).includes(k) ? "down" : "up"}>
                      {FLAG_LABEL[k]}
                    </Pill>
                  ))
                )}
              </div>
              {saved.freeText && (
                <p className="line-clamp-2 text-xs text-muted-foreground" title={saved.freeText}>
                  <span className="text-foreground/80">План:</span> {saved.freeText}
                </p>
              )}
            </div>
          </div>
          <div className="min-w-0 space-y-2 border-t border-border/60 pt-3 md:border-l md:border-t-0 md:pl-4 md:pt-0">
            <div className="flex items-center justify-between gap-2">
              <span className="micro-label">Готовность · 14 дней</span>
              <Sparkline values={spark} width={128} height={26} domain={[0, 100]} tone={tone} connectGaps label="Готовность за 14 дней" />
            </div>
            {insightsQ.isError ? (
              <WidgetError message="История недоступна" onRetry={() => insightsQ.refetch()} />
            ) : insights ? (
              <Correlation data={insights} />
            ) : (
              <Skeleton className="h-12 w-full rounded-xl" />
            )}
          </div>
        </div>
      </WidgetShell>
    );
  }

  /* ───────── Snoozed (not filled, user chose "позже") ───────── */
  if (!saved && collapsed) {
    return (
      <div className="glass-panel flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-[hsl(var(--chart-3)/0.15)] text-[hsl(var(--chart-3))]">
          <Sun className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Чек-ин не заполнен</div>
          <div className="text-xs text-muted-foreground">3 нажатия — и видно, в каком состоянии ты торгуешь лучше.</div>
        </div>
        <Button size="sm" variant="secondary" onClick={() => snooze(false)}>
          <ChevronDown aria-hidden="true" /> Заполнить
        </Button>
      </div>
    );
  }

  /* ───────── Form: 3 taps + plan ───────── */
  return (
    <WidgetShell
      icon={Sun}
      title={saved ? "Изменить чек-ин" : "Как ты сегодня?"}
      meta={streak > 0 ? `серия ${streak} дн.` : "20 секунд перед сессией"}
      accent="warn"
      actions={
        saved ? (
          <Button size="sm" variant="ghost" onClick={() => { setDraft(rowToDraft(saved)); setEditing(false); }}>
            Отмена
          </Button>
        ) : (
          <IconAction icon={ChevronUp} label="Свернуть до конца дня" onClick={() => snooze(true)} />
        )
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-6">
          <div className="min-w-0 flex-1 space-y-2.5">
            <Step n={1} label="Сон" done={draft.sleep != null}>
              <Choice active={draft.sleep === true} tone="up" icon={Moon} onClick={() => setDraft((d) => ({ ...d, sleep: true }))}>
                Выспался
              </Choice>
              <Choice active={draft.sleep === false} tone="down" onClick={() => setDraft((d) => ({ ...d, sleep: false }))}>
                Не выспался
              </Choice>
            </Step>
            <Step n={2} label="Фокус" done={draft.focus != null}>
              <Choice active={draft.focus === true} tone="up" icon={Target} onClick={() => setDraft((d) => ({ ...d, focus: true }))}>
                Собран
              </Choice>
              <Choice active={draft.focus === false} tone="down" onClick={() => setDraft((d) => ({ ...d, focus: false }))}>
                Рассеян
              </Choice>
            </Step>
            <Step n={3} label="Эмоции" done={draft.sleep != null && draft.focus != null}>
              <Choice
                active={calm}
                tone="up"
                onClick={() => setDraft((d) => ({ ...d, stressed: false, anxious: false, tilted: false, revenge: false }))}
              >
                Спокоен
              </Choice>
              {(["stressed", "anxious", "tilted", "revenge"] as const).map((k) => (
                <Choice
                  key={k}
                  active={draft[k]}
                  tone="down"
                  icon={k === "tilted" ? Flame : undefined}
                  onClick={() => setDraft((d) => ({ ...d, [k]: !d[k] }))}
                >
                  {FLAG_LABEL[k]}
                </Choice>
              ))}
            </Step>
          </div>

          <div className="flex shrink-0 items-center gap-3 rounded-xl bg-foreground/[0.04] px-3 py-2.5 lg:w-60" aria-live="polite">
            <ReadinessRing score={ready ? score : 0} />
            <div className="min-w-0">
              <div className="text-2xs text-muted-foreground">Готовность</div>
              <div className="text-sm font-semibold">{ready ? readinessLabel(score) : "Отметь сон и фокус"}</div>
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="morning-checkin-plan" className="text-xs text-muted-foreground">
            План на сессию <span className="text-muted-foreground/80">· необязательно</span>
          </label>
          <Textarea
            id="morning-checkin-plan"
            value={draft.plan}
            onChange={(e) => setDraft((d) => ({ ...d, plan: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            maxLength={2000}
            placeholder="Тикеры, сетапы, лимит убытка на день…"
            className="min-h-[52px] resize-none"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-2xs text-muted-foreground">Ctrl+Enter — сохранить</span>
          <Button type="submit" size="sm" disabled={!ready || submitting}>
            <Check aria-hidden="true" /> {submitting ? "Сохранение…" : "Сохранить чек-ин"}
          </Button>
        </div>
      </form>
    </WidgetShell>
  );
}

/** 14 calendar days ending `today` mapped to readiness (null for days without check-in). */
function useMemoSpark(days: CheckinInsights["days"], today: string): Array<number | null> {
  return useMemo(() => {
    const byDate = new Map(days.map((d) => [d.date, d.readiness]));
    const out: Array<number | null> = [];
    for (let i = 13; i >= 0; i--) out.push(byDate.get(addDays(today, -i)) ?? null);
    return out;
  }, [days, today]);
}
