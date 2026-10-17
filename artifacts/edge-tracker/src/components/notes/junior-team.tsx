import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BellRing, Check, Inbox, Play, ChevronLeft, ChevronRight, ChevronDown, Flame, Loader2, MessageSquareQuote, Sparkles, Users, X,
} from "lucide-react";
import { EmptyState, Panel, Pill, StatCard, StatGrid } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  HttpError, api, composeSections, lastTradingDays, fmtDayLong, fmtDayShort, localToday, nextTradingDay, prevTradingDay, qk,
  relTime, sectionsOf, type JuniorNote, type OverviewRow,
} from "./junior-lib";
import { Initial, LoadError, MarkdownText, MoodPill, ScoreStars } from "./junior-ui";
import { JuniorNoteSheet } from "./junior-note-sheet";

export function JuniorTeam({ isPrivileged, me }: { isPrivileged: boolean; me: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const today = localToday();
  const [date, setDate] = React.useState(() => lastTradingDays(today, 1)[0]!);
  const [opened, setOpened] = React.useState<{ id: number; src: "team" | "queue" } | null>(null);
  const setOpenId = (id: number | null) => setOpened(id == null ? null : { id, src: "team" });
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [summary, setSummary] = React.useState<string | null>(null);
  const [summarizing, setSummarizing] = React.useState(false);
  const [reminding, setReminding] = React.useState<Set<string>>(new Set());

  const teamQ = useQuery({
    queryKey: qk.team(date),
    queryFn: () => api<JuniorNote[]>(`/junior-notes/team?date=${date}`),
    staleTime: 30_000,
  });
  const overviewQ = useQuery({
    queryKey: qk.overview(date),
    queryFn: () => api<{ date: string; rows: OverviewRow[] }>(`/junior-notes/overview?date=${date}`),
    enabled: isPrivileged,
    staleTime: 30_000,
    retry: (n, e) => !(e instanceof HttpError && (e.status === 404 || e.status === 403)) && n < 2,
  });

  const queueQ = useQuery({
    queryKey: qk.queue,
    queryFn: () => api<JuniorNote[]>("/junior-notes/queue?days=14"),
    enabled: isPrivileged,
    staleTime: 30_000,
    retry: (n, e) => !(e instanceof HttpError && (e.status === 404 || e.status === 403)) && n < 2,
  });
  const queue = queueQ.data ?? [];

  React.useEffect(() => { setSelected(new Set()); setSummary(null); }, [date]);

  const notes = React.useMemo(() => (teamQ.data ?? []).filter((n) => n.raw_text?.trim()), [teamQ.data]);
  const rows = overviewQ.data?.rows ?? [];
  const wrote = rows.filter((r) => r.note);
  const missed = rows.filter((r) => !r.note);
  const awaiting = notes.filter((n) => !n.reviewed_at);
  const teamAvg = (() => {
    const s = rows.filter((r) => r.avg_score != null).map((r) => r.avg_score!);
    return s.length ? (s.reduce((a, b) => a + b, 0) / s.length).toFixed(1) : "—";
  })();

  const remind = async (traders: string[]) => {
    if (!traders.length) return;
    setReminding((s) => new Set([...s, ...traders]));
    let ok = 0;
    for (const t of traders) {
      try {
        const r = await api<{ id: number; curator: string; created_at: string }>("/junior-notes/reminders", {
          method: "POST",
          json: { trader: t, date },
        });
        ok++;
        qc.setQueryData<{ date: string; rows: OverviewRow[] }>(qk.overview(date), (prev) =>
          prev && { ...prev, rows: prev.rows.map((x) => (x.trader === t ? { ...x, reminder: { id: r.id, curator: r.curator, created_at: r.created_at } } : x)) },
        );
      } catch { /* counted below */ }
    }
    setReminding((s) => { const n = new Set(s); traders.forEach((t) => n.delete(t)); return n; });
    if (ok === traders.length) toast({ title: ok === 1 ? `Напоминание для ${traders[0]} отправлено` : `Напоминания отправлены: ${ok}`, description: "Трейдер увидит его на странице сводки" });
    else toast({ title: `Отправлено ${ok} из ${traders.length}`, variant: "destructive" });
  };

  const generateSummary = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    setSummarizing(true);
    setSummary(null);
    try {
      const d = await api<{ summary?: string }>("/junior-notes/team-summary", { method: "POST", json: { note_ids: ids } });
      if (d.summary) setSummary(d.summary);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "AI недоступен", variant: "destructive" });
    } finally {
      setSummarizing(false);
    }
  };

  const openNote =
    opened == null ? null : (opened.src === "queue" ? queue : notes).find((n) => n.id === opened.id) ?? null;
  const queueIdx = opened?.src === "queue" ? queue.findIndex((n) => n.id === opened.id) : -1;

  /** After answering in queue mode jump to the next unanswered note (review flow without closing the sheet). */
  const advanceQueue = (updated: JuniorNote) => {
    if (opened?.src !== "queue") return;
    const rest = queue.filter((n) => n.id !== updated.id);
    const idx = Math.max(0, queue.findIndex((n) => n.id === updated.id));
    const next = rest[idx] ?? rest[0];
    if (next) setOpened({ id: next.id, src: "queue" });
    else { setOpened(null); toast({ title: "Очередь разобрана", description: "Все сводки за 14 дней с ответом куратора" }); }
  };
  const openByTrader = (trader: string) => {
    const n = notes.find((x) => x.trader === trader);
    if (n) setOpenId(n.id);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Day switcher */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="icon" variant="ghost" className="h-9 w-9" aria-label="Предыдущий торговый день" onClick={() => setDate(prevTradingDay(date))}>
          <ChevronLeft />
        </Button>
        <label className="glass-field relative inline-flex min-h-9 cursor-pointer items-center gap-2 px-3.5 text-sm font-medium focus-within:ring-2 focus-within:ring-ring">
          <span className="first-letter:uppercase">{fmtDayLong(date)}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <input type="date" aria-label="Дата сводок команды" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
        </label>
        <Button size="icon" variant="ghost" className="h-9 w-9" aria-label="Следующий торговый день" disabled={nextTradingDay(date) > today} onClick={() => setDate(nextTradingDay(date))}>
          <ChevronRight />
        </Button>
        {date !== today && <Button size="sm" variant="outline" onClick={() => setDate(today)}>Сегодня</Button>}
        {!isPrivileged && <Pill tone="neutral" className="ml-auto">только чтение</Pill>}
      </div>

      {/* Curator desk overview */}
      {isPrivileged && (overviewQ.isLoading ? (
        <>
          <StatGrid>{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[92px] rounded-2xl" />)}</StatGrid>
          <Skeleton className="h-64 w-full rounded-2xl" />
        </>
      ) : overviewQ.isError ? (
        overviewQ.error instanceof HttpError && overviewQ.error.status === 404 ? null : (
          <LoadError text="Не удалось загрузить обзор команды" onRetry={() => overviewQ.refetch()} />
        )
      ) : (
        <>
          <StatGrid>
            <StatCard label="Написали" value={`${wrote.length} / ${rows.length}`} tone={rows.length && wrote.length === rows.length ? "up" : "neutral"} hint={date === today ? "сегодня" : fmtDayShort(date)} />
            <StatCard label="Без сводки" value={missed.length} tone={missed.length ? "warn" : "up"} hint={missed.filter((r) => r.reminder).length ? `напомнили ${missed.filter((r) => r.reminder).length}` : undefined} />
            <StatCard label="Ждут ответа" value={awaiting.length} tone={awaiting.length ? "accent" : "neutral"} hint="за этот день" />
            <StatCard label="Средняя оценка" value={teamAvg} hint="за 90 дней" />
          </StatGrid>

          <Panel
            title="Команда"
            icon={Users}
            description="Кто написал сводку, серия дней подряд и статус ответа"
            actions={
              missed.filter((r) => !r.reminder).length > 0 ? (
                <Button size="sm" variant="outline" disabled={reminding.size > 0} onClick={() => void remind(missed.filter((r) => !r.reminder).map((r) => r.trader))}>
                  <BellRing aria-hidden="true" />
                  Напомнить всем ({missed.filter((r) => !r.reminder).length})
                </Button>
              ) : undefined
            }
            padded={false}
          >
            {rows.length === 0 ? (
              <EmptyState icon={Users} title="Нет активных трейдеров" />
            ) : (
              <ul className="divide-y divide-border px-2 pb-2 sm:px-3">
                {rows.map((r) => (
                  <RosterRow
                    key={r.trader}
                    r={r}
                    busy={reminding.has(r.trader)}
                    onOpen={() => openByTrader(r.trader)}
                    onRemind={() => void remind([r.trader])}
                  />
                ))}
              </ul>
            )}
          </Panel>
        </>
      ))}

      {/* Review queue across days */}
      {isPrivileged && !(queueQ.error instanceof HttpError && queueQ.error.status === 404) && (
        <Panel
          title="Очередь ответа"
          icon={Inbox}
          description="Сводки за 14 дней без ответа куратора — от старых к новым"
          actions={
            queue.length > 0 ? (
              <Button size="sm" onClick={() => setOpened({ id: queue[0]!.id, src: "queue" })}>
                <Play aria-hidden="true" />Разобрать по очереди ({queue.length})
              </Button>
            ) : undefined
          }
        >
          {queueQ.isLoading ? (
            <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
          ) : queueQ.isError ? (
            <LoadError text="Не удалось загрузить очередь" onRetry={() => queueQ.refetch()} />
          ) : queue.length === 0 ? (
            <p className="text-sm text-muted-foreground">Все сводки за две недели с ответом. Отличная работа.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {queue.slice(0, 8).map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => setOpened({ id: n.id, src: "queue" })}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="w-14 shrink-0 text-xs tabular-nums text-muted-foreground">{fmtDayShort(n.note_date)}</span>
                    <Initial name={n.trader} className="h-7 w-7" />
                    <span className="shrink-0 text-sm font-medium">{n.trader}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{composeSections(sectionsOf(n)) || n.raw_text}</span>
                    <MoodPill mood={n.mood} />
                  </button>
                </li>
              ))}
              {queue.length > 8 && <li className="px-2 pt-1 text-xs text-muted-foreground">и ещё {queue.length - 8}</li>}
            </ul>
          )}
        </Panel>
      )}

      {/* Notes of the day */}
      <Panel
        title="Сводки за день"
        description={isPrivileged ? "Открой, чтобы оценить и ответить. Отметь несколько для общей AI-сводки." : "Сводки команды — учись на разборах коллег"}
        actions={
          isPrivileged && notes.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSelected(selected.size === notes.length ? new Set() : new Set(notes.map((n) => n.id)))}>
                {selected.size === notes.length ? "Снять все" : "Выбрать все"}
              </Button>
              <Button size="sm" variant="outline" disabled={summarizing || selected.size === 0} onClick={() => void generateSummary()}>
                {summarizing ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                {summarizing ? "AI анализирует…" : `AI-сводка${selected.size ? ` (${selected.size})` : ""}`}
              </Button>
            </div>
          ) : undefined
        }
      >
        {summary && (
          <div className="mb-4 rounded-xl bg-primary/10 p-4">
            <div className="mb-2 flex items-center gap-1.5 text-sm text-primary">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              <span className="font-medium">AI-сводка группы</span>
              <button type="button" aria-label="Закрыть сводку" onClick={() => setSummary(null)} className="ml-auto grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <MarkdownText text={summary} />
          </div>
        )}

        {teamQ.isLoading ? (
          <div className="grid gap-3 md:grid-cols-2" aria-busy="true">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
          </div>
        ) : teamQ.isError ? (
          <LoadError text="Не удалось загрузить сводки команды" onRetry={() => teamQ.refetch()} />
        ) : notes.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Никто ещё не написал сводку за этот день"
            description={date === today ? "Сводки появятся здесь, как только трейдеры их сохранят." : undefined}
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {notes.map((n) => {
              const isSel = selected.has(n.id);
              const text = composeSections(sectionsOf(n));
              return (
                <li key={n.id} className={cn("relative rounded-xl bg-[var(--glass-bg)] transition-shadow", isSel && "ring-1 ring-primary/60")}>
                  <button
                    type="button"
                    onClick={() => setOpenId(n.id)}
                    className="flex h-full w-full flex-col gap-2 rounded-xl p-4 text-left hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className={cn("flex flex-wrap items-center gap-2", isPrivileged && "pr-9")}>
                      <Initial name={n.trader} />
                      <span className="text-sm font-semibold">{n.trader}</span>
                      <MoodPill mood={n.mood} />
                    </div>
                    <p className="line-clamp-3 text-sm text-muted-foreground">{text || n.raw_text}</p>
                    <div className="mt-auto flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
                      {n.reviewed_at ? (
                        <>
                          <Pill tone="up"><MessageSquareQuote className="h-3 w-3" aria-hidden="true" />Ответ {n.reviewed_by}</Pill>
                          <ScoreStars score={n.curator_score} />
                        </>
                      ) : (
                        <Pill tone="accent" dot>Ждёт ответа</Pill>
                      )}
                      <span className="ml-auto">{relTime(n.updated_at)}</span>
                    </div>
                  </button>
                  {isPrivileged && (
                    <button
                      type="button"
                      aria-pressed={isSel}
                      aria-label={`Выбрать сводку ${n.trader} для AI-сводки`}
                      onClick={() => setSelected((p) => { const s = new Set(p); if (s.has(n.id)) s.delete(n.id); else s.add(n.id); return s; })}
                      className={cn(
                        "absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isSel ? "border-primary bg-primary text-primary-foreground" : "border-[var(--field-border)] text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Check className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <JuniorNoteSheet
        note={openNote}
        open={openNote != null}
        onOpenChange={(o) => { if (!o) setOpenId(null); }}
        mode={isPrivileged && openNote?.trader !== me ? "curator" : openNote?.trader === me ? "owner" : "reader"}
        onReviewed={advanceQueue}
        submitLabel={opened?.src === "queue" ? (queue.length > 1 ? "Отправить и дальше" : "Отправить и закончить") : undefined}
        queueInfo={queueIdx >= 0 ? `${queueIdx + 1} из ${queue.length}` : undefined}
      />
    </div>
  );
}

function RosterRow({ r, busy, onOpen, onRemind }: { r: OverviewRow; busy: boolean; onOpen: () => void; onRemind: () => void }) {
  const n = r.note;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-2 py-3">
      <Initial name={r.trader} />
      <div className="min-w-0 flex-1 basis-40">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{r.trader}</span>
          {n ? (
            <Pill tone="up" dot>Написал{n.words ? ` · ${n.words} сл.` : ""}</Pill>
          ) : r.reminder ? (
            <Pill tone="warn" dot>Напомнили {relTime(r.reminder.created_at)}</Pill>
          ) : (
            <Pill tone="down" dot>Нет сводки</Pill>
          )}
          {r.streak > 0 && (
            <Pill tone={r.streak >= 5 ? "accent" : "neutral"}>
              <Flame className="h-3 w-3" aria-hidden="true" />{r.streak} подряд
            </Pill>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {n
            ? n.preview || "Пустая сводка"
            : r.last_note_date ? `Последняя сводка: ${fmtDayShort(r.last_note_date)}` : "Ещё ни одной сводки"}
          {" · "}
          {r.notes_30d} за 30 дн.
          {r.unreviewed_14d > 0 && ` · без ответа: ${r.unreviewed_14d}`}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {n?.reviewed_at ? <ScoreStars score={n.curator_score} /> : null}
        {n ? (
          <Button size="sm" variant={n.reviewed_at ? "ghost" : "outline"} onClick={onOpen}>
            {n.reviewed_at ? "Открыть" : "Ответить"}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onRemind} aria-label={`Напомнить ${r.trader} написать сводку`}>
            {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <BellRing aria-hidden="true" />}
            {r.reminder ? "Ещё раз" : "Напомнить"}
          </Button>
        )}
      </div>
    </li>
  );
}
