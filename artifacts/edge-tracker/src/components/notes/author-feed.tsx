import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCheck, ChevronDown, ListChecks, RefreshCw, Sparkles, Users, X } from "lucide-react";
import { EmptyState, FilterChip, Panel, Pill, Segmented, Toolbar } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { AuthorMarkdown, NoteReader } from "./author-reader";
import { AN_KEYS, addDays, api, fetchFeed, fmtDayLong, fmtDayShort, moodOf, type FeedNote } from "./author-model";

export type FeedRange = "day" | "week" | "month";
const RANGE_DAYS: Record<FeedRange, number> = { day: 0, week: 6, month: 29 };

export function feedRange(anchor: string, range: FeedRange) {
  return { from: addDays(anchor, -RANGE_DAYS[range]), to: anchor };
}

export function useAuthorFeed(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: AN_KEYS.feed(from, to),
    queryFn: () => fetchFeed(from, to),
    enabled,
    staleTime: 30_000,
    refetchInterval: 120_000,
  });
}

function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/15 text-sm font-semibold text-primary", className)}
      aria-hidden="true"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function ReadReceipts({ note }: { note: FeedNote }) {
  if (note.legacy) return null;
  if (!note.reads.length) return <span className="text-xs text-muted-foreground">Пока никто не прочитал</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground" tabIndex={0}>
          <span className="flex -space-x-1.5">
            {note.reads.slice(0, 5).map((r) => (
              <Avatar key={r.reader} name={r.reader} className="h-6 w-6 text-2xs ring-2 ring-background" />
            ))}
          </span>
          Прочитали: {note.reads.length}
        </span>
      </TooltipTrigger>
      <TooltipContent className="whitespace-pre-line">
        {note.reads.map((r) => `${r.reader} · ${new Date(r.read_at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`).join("\n")}
      </TooltipContent>
    </Tooltip>
  );
}

function FeedCard({
  note,
  me,
  showDate,
  selecting,
  selected,
  onToggleSelect,
  onToggleRead,
  busy,
}: {
  note: FeedNote;
  me: string;
  showDate: boolean;
  selecting: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onToggleRead: () => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [ai, setAi] = React.useState(false);
  const mine = note.trader === me;
  const mood = moodOf(note.mood);
  const long = (note.raw_text?.length ?? 0) > 700;
  const unread = !mine && !note.read_by_me && !note.legacy;

  return (
    <article
      className={cn(
        "glass-panel relative flex flex-col gap-3 rounded-2xl p-4 sm:p-5 transition-shadow",
        selected && "ring-2 ring-primary/50",
      )}
      aria-label={`Сводка ${note.trader} за ${fmtDayShort(note.note_date)}`}
    >
      {unread && <span className="absolute left-0 top-6 h-6 w-1 rounded-r-full bg-primary" aria-hidden="true" />}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {selecting && (
          <button
            type="button"
            onClick={onToggleSelect}
            aria-pressed={selected}
            aria-label={`Выбрать сводку ${note.trader} для общей сводки`}
            className={cn(
              "grid h-6 w-6 place-items-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected ? "border-primary bg-primary text-primary-foreground" : "border-[var(--field-border)]",
            )}
          >
            {selected && <Check className="h-3.5 w-3.5" />}
          </button>
        )}
        <Avatar name={note.trader} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {note.trader}
            {mine && <Pill>моя</Pill>}
            {unread && <Pill tone="accent" dot>новая</Pill>}
          </span>
          <span className="text-xs capitalize text-muted-foreground">
            {showDate ? fmtDayLong(note.note_date) : `обновлено ${new Date(note.updated_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`}
          </span>
        </div>
        {mood && (
          <span className="text-sm" title={mood.label}>
            <span aria-hidden="true">{mood.emoji}</span> <span className="text-xs text-muted-foreground">{mood.label}</span>
          </span>
        )}
      </header>

      {note.refined_text && (
        <div className="glass-field inline-flex self-start p-0.5" role="group" aria-label="Версия">
          <button type="button" aria-pressed={!ai} onClick={() => setAi(false)} className={cn("min-h-7 rounded-full px-2.5 text-xs font-medium", !ai ? "bg-primary-solid text-primary-foreground" : "text-muted-foreground")}>Оригинал</button>
          <button type="button" aria-pressed={ai} onClick={() => setAi(true)} className={cn("inline-flex min-h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium", ai ? "bg-primary-solid text-primary-foreground" : "text-muted-foreground")}>
            <Sparkles className="h-3 w-3" aria-hidden="true" />AI
          </button>
        </div>
      )}

      <div className={cn("relative", long && !expanded && "max-h-72 overflow-hidden")}>
        {ai && note.refined_text ? <AuthorMarkdown text={note.refined_text} /> : <NoteReader raw={note.raw_text} compact />}
        {long && !expanded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[hsl(var(--card))] to-transparent" aria-hidden="true" />
        )}
      </div>
      {long && (
        <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="inline-flex items-center gap-1 self-start text-xs font-medium text-primary hover:underline">
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} aria-hidden="true" />
          {expanded ? "Свернуть" : "Читать полностью"}
        </button>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        {mine ? <ReadReceipts note={note} /> : note.legacy ? <span /> : (
          <span className="text-xs text-muted-foreground">
            {note.read_by_me ? "Ты отметил как прочитанное" : "Прочитай и отметь — автор увидит"}
          </span>
        )}
        {!mine && !note.legacy && (
          <Button
            size="sm"
            variant={note.read_by_me ? "ghost" : "outline"}
            onClick={onToggleRead}
            disabled={busy}
            aria-pressed={note.read_by_me}
            className="gap-1.5"
          >
            {note.read_by_me ? <CheckCheck className="h-3.5 w-3.5 text-up" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
            {note.read_by_me ? "Прочитано" : "Отметить прочитанным"}
          </Button>
        )}
      </footer>
    </article>
  );
}

export function AuthorFeed({
  anchor,
  me,
  range,
  onRangeChange,
}: {
  anchor: string;
  me: string;
  range: FeedRange;
  onRangeChange: (r: FeedRange) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { from, to } = feedRange(anchor, range);
  const key = AN_KEYS.feed(from, to);
  const q = useAuthorFeed(from, to);
  const [author, setAuthor] = React.useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = React.useState(false);
  const [selecting, setSelecting] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [summary, setSummary] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<number | null>(null);

  React.useEffect(() => { setSelected(new Set()); setSummary(null); }, [from, to]);

  const notes = q.data ?? [];
  const authors = React.useMemo(() => Array.from(new Set(notes.map((n) => n.trader))).sort((a, b) => a.localeCompare(b, "ru")), [notes]);
  const visible = notes.filter((n) => (!author || n.trader === author) && (!unreadOnly || (!n.read_by_me && n.trader !== me)));
  const unread = notes.filter((n) => !n.read_by_me && n.trader !== me && !n.legacy);
  const legacy = notes.some((n) => n.legacy);

  const patchRead = (id: number, read: boolean) => {
    qc.setQueryData<FeedNote[]>(key, (prev) =>
      prev?.map((n) =>
        n.id !== id
          ? n
          : {
              ...n,
              read_by_me: read,
              reads: read
                ? n.reads.some((r) => r.reader === me) ? n.reads : [...n.reads, { reader: me, read_at: new Date().toISOString() }]
                : n.reads.filter((r) => r.reader !== me),
            },
      ),
    );
  };

  const toggleRead = useMutation({
    mutationFn: async ({ id, read }: { id: number; read: boolean }) =>
      api(`/author-notes/${id}/read`, { method: read ? "POST" : "DELETE" }),
    onMutate: ({ id, read }) => { setBusyId(id); patchRead(id, read); },
    onError: (e: Error, { id, read }) => {
      patchRead(id, !read);
      toast({ title: "Не удалось отметить", description: e.message, variant: "destructive" });
    },
    onSettled: () => { setBusyId(null); void qc.invalidateQueries({ queryKey: ["author-notes", "feed"] }); },
  });

  const markAll = useMutation({
    mutationFn: async (ids: number[]) => {
      for (const id of ids) await api(`/author-notes/${id}/read`, { method: "POST" });
    },
    onMutate: (ids) => ids.forEach((id) => patchRead(id, true)),
    onError: (e: Error) => toast({ title: "Не все отметки сохранились", description: e.message, variant: "destructive" }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["author-notes", "feed"] }),
  });

  const teamSummary = useMutation({
    mutationFn: (ids: number[]) => api<{ summary: string }>(`/author-notes/team-summary`, { method: "POST", body: JSON.stringify({ note_ids: ids }) }),
    onSuccess: (d) => { setSummary(d.summary); setSelecting(false); },
    onError: (e: Error) => toast({ title: "AI-сводка не получилась", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="flex flex-col gap-4">
      <Toolbar className="justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            ariaLabel="Период ленты"
            size="sm"
            value={range}
            onChange={onRangeChange}
            options={[
              { value: "day", label: "День" },
              { value: "week", label: "7 дней" },
              { value: "month", label: "30 дней" },
            ]}
          />
          <FilterChip active={unreadOnly} onClick={() => setUnreadOnly((v) => !v)} count={unread.length}>Непрочитанные</FilterChip>
          {authors.length > 1 && authors.map((a) => (
            <FilterChip key={a} active={author === a} onClick={() => setAuthor(author === a ? null : a)}>{a}</FilterChip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {unread.length > 0 && (
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => markAll.mutate(unread.map((n) => n.id))} disabled={markAll.isPending}>
              <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />Прочитать все
            </Button>
          )}
          {notes.length > 0 && (selecting ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => { setSelecting(false); setSelected(new Set()); }}>Отмена</Button>
              <Button
                size="sm"
                className="gap-1.5"
                disabled={selected.size === 0 || teamSummary.isPending}
                onClick={() => teamSummary.mutate(Array.from(selected))}
              >
                {teamSummary.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
                {teamSummary.isPending ? "AI анализирует…" : `Общая сводка · ${selected.size}`}
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setSelecting(true); setSelected(new Set(visible.map((n) => n.id))); }}>
              <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />AI-сводка команды
            </Button>
          ))}
        </div>
      </Toolbar>

      {legacy && (
        <p className="px-1 text-xs text-muted-foreground">Отметки «прочитано» и период появятся после обновления сервера — сейчас показан только выбранный день.</p>
      )}

      {summary && (
        <Panel
          title="AI-сводка команды"
          icon={Sparkles}
          actions={<Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Закрыть сводку" onClick={() => setSummary(null)}><X className="h-4 w-4" /></Button>}
        >
          <AuthorMarkdown text={summary} />
        </Panel>
      )}

      {q.isLoading ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Загрузка ленты">
          {[0, 1].map((i) => <Skeleton key={i} className="h-48 rounded-2xl" />)}
        </div>
      ) : q.isError ? (
        <Panel>
          <EmptyState icon={Users} title="Не удалось загрузить ленту" description={(q.error as Error)?.message} action={<Button variant="outline" onClick={() => q.refetch()}>Повторить</Button>} />
        </Panel>
      ) : visible.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Users}
            title={unreadOnly ? "Всё прочитано" : "Сводок за этот период нет"}
            description={unreadOnly ? "Новых сводок от команды нет." : `Период ${fmtDayShort(from)} — ${fmtDayShort(to)} · попробуй расширить диапазон`}
            action={!unreadOnly && range !== "month" ? <Button variant="outline" onClick={() => onRangeChange(range === "day" ? "week" : "month")}>Показать {range === "day" ? "7 дней" : "30 дней"}</Button> : undefined}
          />
        </Panel>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((n) => (
            <FeedCard
              key={n.id}
              note={n}
              me={me}
              showDate={range !== "day"}
              selecting={selecting}
              selected={selected.has(n.id)}
              onToggleSelect={() => setSelected((prev) => { const next = new Set(prev); if (next.has(n.id)) next.delete(n.id); else next.add(n.id); return next; })}
              onToggleRead={() => toggleRead.mutate({ id: n.id, read: !n.read_by_me })}
              busy={busyId === n.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
