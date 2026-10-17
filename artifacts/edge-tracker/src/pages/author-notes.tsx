import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, AlertTriangle, BookmarkPlus, Check, ChevronLeft, ChevronRight, Copy, Eye, LayoutTemplate, Loader2,
  Mic, MicOff, MoreHorizontal, NotebookPen, RefreshCw, Sparkles, Trash2, X,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, Page, PageHeader, Panel, Segmented } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { AuthorEditor, type EditorMode, type EditorTarget } from "@/components/notes/author-editor";
import { AuthorDayContext, heldLine, tradeLine } from "@/components/notes/author-day-context";
import { AuthorWeeklyCard } from "@/components/notes/author-weekly";
import { AuthorHistory } from "@/components/notes/author-history";
import { AuthorFeed, feedRange, useAuthorFeed, type FeedRange } from "@/components/notes/author-feed";
import { AuthorMarkdown } from "@/components/notes/author-reader";
import { useDictation } from "@/components/notes/author-dictation";
import { AuthorAudience } from "@/components/notes/author-audience";
import { AuthorPrevPlan } from "@/components/notes/author-prev-plan";
import {
  FOLLOW_HEADER, findPrevPlan, followThroughBlock, moneyMentions, sectionForDigit, type FollowItem,
} from "@/components/notes/author-plan";
import {
  AN_KEYS, BUILTIN_TEMPLATES, HttpError, MOODS, SECTIONS, addDays, api, appendText, applyTemplate,
  fmtDayLong, isIsoDate, loadCustomTemplates, localToday, parseNote, relTime, saveCustomTemplates, serializeNote,
  type Audience, type AuthorNote, type DayContext, type DayTrade, type NoteTemplate, type SectionKey,
} from "@/components/notes/author-model";

type View = "write" | "feed" | "history";
type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

const VIEW_KEY = "ws_author_notes_view";
const MODE_KEY = "ws_author_notes_mode";
const RANGE_KEY = "ws_author_notes_range";
const AUTOSAVE_MS = 1500;

function readLS<T extends string>(key: string, allowed: readonly T[], def: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : def;
  } catch { return def; }
}
function writeLS(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* storage unavailable */ }
}

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

function upsertHistory(list: AuthorNote[] | undefined, note: AuthorNote): AuthorNote[] | undefined {
  if (!list) return list;
  const rest = list.filter((n) => n.id !== note.id && n.note_date.slice(0, 10) !== note.note_date.slice(0, 10));
  return [note, ...rest].sort((a, b) => (a.note_date < b.note_date ? 1 : -1));
}

function SaveIndicator({ status, savedAt, now, onRetry }: { status: SaveStatus; savedAt: number | null; now: number; onRetry: () => void }) {
  if (status === "saving") {
    return <span role="status" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />Сохраняю…</span>;
  }
  if (status === "error") {
    return (
      <span role="alert" className="inline-flex items-center gap-1.5 text-xs text-down">
        <AlertCircle className="h-3 w-3" aria-hidden="true" />Не сохранено
        <button type="button" onClick={onRetry} className="font-medium underline-offset-2 hover:underline">Повторить</button>
      </span>
    );
  }
  if (status === "dirty") {
    return <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--chart-3))]" aria-hidden="true" />Есть изменения</span>;
  }
  if (status === "saved" && savedAt) {
    return <span role="status" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Check className="h-3 w-3 text-up" aria-hidden="true" />Сохранено · {relTime(savedAt, now)}</span>;
  }
  return <span className="text-xs text-muted-foreground">Черновик — сохранится автоматически</span>;
}

export default function AuthorNotesPage() {
  const { user, canEdit } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const trader = user?.traderName ?? "";
  const today = localToday();

  /* ── View, date, URL ── */
  const initial = useMemo(() => {
    const p = new URLSearchParams(window.location.search);
    const d = p.get("date");
    const v = p.get("view") as View | null;
    return {
      date: isIsoDate(d) && d <= today ? d : today,
      view: v && ["write", "feed", "history"].includes(v) ? v : null,
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [view, setViewState] = useState<View>(() => {
    const v = initial.view ?? readLS<View>(VIEW_KEY, ["write", "feed", "history"], "write");
    return !canEdit && v !== "feed" ? "feed" : v;
  });
  useEffect(() => { if (!canEdit && view !== "feed") setViewState("feed"); }, [canEdit, view]);
  const [date, setDate] = useState(initial.date);
  const [range, setRangeState] = useState<FeedRange>(() => readLS<FeedRange>(RANGE_KEY, ["day", "week", "month"], "week"));
  const setRange = (r: FeedRange) => { setRangeState(r); writeLS(RANGE_KEY, r); };

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (date === today) p.delete("date"); else p.set("date", date);
    if (view === "write") p.delete("view"); else p.set("view", view);
    const qs = p.toString();
    window.history.replaceState(window.history.state, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, [date, view, today]);

  /* ── Editor state ── */
  const [note, setNote] = useState<AuthorNote | null>(null);
  const [raw, setRaw] = useState("");
  const [mood, setMood] = useState("");
  const [mode, setModeState] = useState<EditorMode>(() => readLS<EditorMode>(MODE_KEY, ["sections", "free"], "sections"));
  const [loadState, setLoadState] = useState<"loading" | "ok" | "error">("loading");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [improving, setImproving] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [activeKey, setActiveKey] = useState<EditorTarget | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AuthorNote | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [templates, setTemplates] = useState<NoteTemplate[]>(() => loadCustomTemplates());
  const [tplDialog, setTplDialog] = useState(false);
  const [tplName, setTplName] = useState("");
  const firstFieldRef = useRef<HTMLTextAreaElement | null>(null);

  const rawRef = useRef(raw); rawRef.current = raw;
  const moodRef = useRef(mood); moodRef.current = mood;
  const dateRef = useRef(date); dateRef.current = date;
  const noteRef = useRef(note); noteRef.current = note;
  const loadSeq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setMode = (m: EditorMode) => { setModeState(m); writeLS(MODE_KEY, m); };

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  /* ── Queries ── */
  const historyQ = useQuery({
    queryKey: AN_KEYS.history(trader),
    queryFn: () => api<AuthorNote[]>(`/author-notes/history?trader=${encodeURIComponent(trader)}&limit=366`),
    enabled: !!trader && canEdit,
    staleTime: 60_000,
  });
  const historyNotes = historyQ.data ?? [];

  const dayQ = useQuery({
    queryKey: AN_KEYS.day(date),
    queryFn: () => api<DayContext>(`/author-notes/day-context?date=${date}`),
    enabled: !!trader && canEdit && view === "write",
    staleTime: 60_000,
    retry: (n, e) => !(e instanceof HttpError && e.status < 500) && n < 2,
  });

  // Reach of the open note (who read / who not yet); refreshed while the author keeps the page open.
  const audienceQ = useQuery({
    queryKey: AN_KEYS.audience(note?.id ?? 0),
    queryFn: () => api<Audience>(`/author-notes/${note!.id}/audience`),
    enabled: !!note?.id && view === "write",
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });

  // The last earlier note's «План на завтра» — shown beside the editor to grade follow-through.
  const prevPlan = useMemo(() => findPrevPlan(historyNotes, date), [historyNotes, date]);

  const unreadRange = feedRange(today, "week");
  const unreadQ = useAuthorFeed(unreadRange.from, unreadRange.to, !!trader);
  const unreadCount = (unreadQ.data ?? []).filter((n) => !n.read_by_me && n.trader !== trader && !n.legacy).length;

  /* ── Load note for date ── */
  const loadNote = useCallback(async (d: string) => {
    if (!trader) return;
    const seq = ++loadSeq.current;
    setNote(null); setRaw(""); setMood(""); setShowAi(false);
    setStatus("idle"); setSavedAt(null); setLoadState("loading");
    try {
      const data = await api<AuthorNote | null>(`/author-notes?trader=${encodeURIComponent(trader)}&date=${d}`);
      if (seq !== loadSeq.current) return;
      if (data && data.id) {
        setNote(data);
        setRaw(data.raw_text || "");
        setMood(data.mood || "");
        setStatus("saved");
        setSavedAt(Date.parse(data.updated_at) || Date.now());
        const p = parseNote(data.raw_text || "");
        if (data.raw_text?.trim()) setModeState(p.structured ? "sections" : "free");
      }
      setLoadState("ok");
    } catch {
      if (seq === loadSeq.current) setLoadState("error");
    }
  }, [trader]);

  useEffect(() => { if (canEdit) void loadNote(date); }, [loadNote, date, canEdit]);

  /* ── Save / autosave ── */
  const save = useCallback(async (opts?: { force?: boolean }): Promise<AuthorNote | null> => {
    if (!trader) return null;
    const d = dateRef.current;
    const text = rawRef.current;
    const m = moodRef.current;
    if (!noteRef.current && !text.trim() && !m && !opts?.force) { setStatus("idle"); return null; }
    setStatus("saving");
    try {
      const data = await api<AuthorNote>(`/author-notes`, {
        method: "PUT",
        body: JSON.stringify({ raw_text: text, note_date: d, mood: m || null }),
      });
      if (d === dateRef.current) {
        setNote(data);
        if (rawRef.current === text && moodRef.current === m) { setStatus("saved"); setSavedAt(Date.now()); }
        else setStatus("dirty");
      }
      qc.setQueryData<AuthorNote[]>(AN_KEYS.history(trader), (prev) => upsertHistory(prev, data));
      void qc.invalidateQueries({ queryKey: ["author-notes", "feed"] });
      return data;
    } catch (e) {
      if (d === dateRef.current) setStatus("error");
      toast({ title: "Сводка не сохранилась", description: e instanceof Error ? e.message : "Проверь подключение", variant: "destructive" });
      return null;
    }
  }, [trader, qc, toast]);

  const saveRef = useRef(save); saveRef.current = save;

  const cancelAutosave = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const flush = useCallback(() => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    void saveRef.current();
  }, []);
  const scheduleSave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setStatus("dirty");
    timer.current = setTimeout(() => { timer.current = null; void saveRef.current(); }, AUTOSAVE_MS);
  }, []);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onHide);
    return () => { document.removeEventListener("visibilitychange", onHide); flush(); };
  }, [flush]);

  const edit = useCallback((updater: (prev: string) => string) => {
    setRaw((prev) => updater(prev));
    scheduleSave();
  }, [scheduleSave]);

  const changeMood = (m: string) => {
    setMood(m);
    moodRef.current = m;
    cancelAutosave();
    void save({ force: true });
  };

  const manualSave = async () => {
    cancelAutosave();
    const saved = await save({ force: true });
    if (saved) toast({ title: "Сводка сохранена" });
  };

  /* ── Dictation ── */
  const dictTarget = useRef<EditorTarget>("market");
  const appendTo = useCallback((target: EditorTarget, text: string) => {
    edit((prev) => {
      if (target === "free") {
        const p = parseNote(prev);
        if (!p.structured) return prev ? `${prev}${/\s$/.test(prev) ? "" : " "}${text}` : text;
        return serializeNote(p.sections, p.free ? `${p.free} ${text}` : text);
      }
      const p = parseNote(prev);
      const cur = p.sections[target];
      return serializeNote({ ...p.sections, [target]: cur ? `${cur}${/\s$/.test(cur) ? "" : " "}${text}` : text }, p.free);
    });
  }, [edit]);

  const dictation = useDictation({
    onFinal: (t) => appendTo(dictTarget.current, t),
    onError: (msg) => toast({ title: msg, variant: "destructive" }),
  });

  const startDictation = () => {
    const t: EditorTarget = mode === "free" ? "free" : activeKey && activeKey !== "free" ? activeKey : activeKey === "free" ? "free" : "market";
    dictTarget.current = t;
    setActiveKey(t);
    dictation.start();
  };

  const onFocusTarget = (k: EditorTarget) => {
    setActiveKey(k);
    if (dictation.recording) dictTarget.current = k;
  };

  /* ── Date navigation ── */
  const changeDate = useCallback((d: string) => {
    if (!isIsoDate(d) || d > today || d === dateRef.current) return;
    if (dictation.recording) dictation.stop();
    flush();
    setDate(d);
  }, [today, flush, dictation]);

  const setView = useCallback((v: View) => {
    if (v !== "write") flush();
    setViewState(v);
    writeLS(VIEW_KEY, v);
  }, [flush]);

  const openInEditor = (d: string) => { changeDate(d); setView("write"); };

  /* ── Templates ── */
  const applyTpl = (tpl: NoteTemplate) => {
    setMode("sections");
    edit((prev) => applyTemplate(prev, tpl));
    toast({ title: `Шаблон «${tpl.name}»`, description: "Заполнены только пустые блоки" });
  };

  const saveTemplate = () => {
    const name = tplName.trim();
    if (!name) return;
    const p = parseNote(raw);
    const sections: NoteTemplate["sections"] = {};
    for (const s of SECTIONS) if (p.sections[s.key].trim()) sections[s.key] = p.sections[s.key];
    if (!Object.keys(sections).length) { toast({ title: "Заполни хотя бы один блок", variant: "destructive" }); return; }
    const next = [{ id: `c${Date.now()}`, name, description: "Мой шаблон", sections, custom: true }, ...templates.filter((t) => t.name !== name)];
    setTemplates(next);
    saveCustomTemplates(next);
    setTplDialog(false);
    setTplName("");
    toast({ title: "Шаблон сохранён" });
  };

  const removeTemplate = (id: string) => {
    const next = templates.filter((t) => t.id !== id);
    setTemplates(next);
    saveCustomTemplates(next);
  };

  /* ── Insert from the day's trades ── */
  const insertTrades = (trades: DayTrade[]) => {
    setMode("sections");
    edit((prev) => {
      const p = parseNote(prev);
      const next = { ...p.sections };
      for (const t of trades) {
        const k: SectionKey = t.horizon;
        if (!next[k].includes(`• ${t.ticker} `) && !next[k].includes(`• ${t.ticker}`)) next[k] = appendText(next[k], tradeLine(t));
      }
      return serializeNote(next, p.free);
    });
  };
  const insertHeld = (held: DayTrade[]) => {
    setMode("sections");
    edit((prev) => {
      const p = parseNote(prev);
      let hold = p.sections.hold;
      for (const t of held) if (!hold.includes(`• ${t.ticker}`)) hold = appendText(hold, heldLine(t));
      return serializeNote({ ...p.sections, hold }, p.free);
    });
  };

  /* ── Jump to a block (Alt+1…7, nudges) ── */
  const focusSection = (k: SectionKey) => {
    if (mode !== "sections") setMode("sections");
    setActiveKey(k); // makes folded overnight / swing blocks visible
    setTimeout(() => {
      const el = document.getElementById(`author-s-${k}`) as HTMLTextAreaElement | null;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 40);
  };

  /* ── «План vs факт» from the previous note into «Уроки» ── */
  const insertFollowThrough = (items: FollowItem[]) => {
    if (!prevPlan) return;
    if (parseNote(rawRef.current).sections.lessons.includes(FOLLOW_HEADER)) {
      toast({ title: "«План vs факт» уже в уроках" });
      focusSection("lessons");
      return;
    }
    const block = followThroughBlock(prevPlan.date, items);
    setMode("sections");
    edit((prev) => {
      const p = parseNote(prev);
      const cur = p.sections.lessons.replace(/\s+$/, "");
      return serializeNote({ ...p.sections, lessons: cur ? `${cur}\n\n${block}` : block }, p.free);
    });
    focusSection("lessons");
  };

  /* ── AI improve (user-triggered) ── */
  const improve = async () => {
    if (!raw.trim()) { toast({ title: "Сначала запиши мысли", variant: "destructive" }); return; }
    setImproving(true);
    try {
      cancelAutosave();
      const saved = await save({ force: true });
      if (!saved) return;
      const d = await api<{ refined_text?: string }>(`/author-notes/improve`, {
        method: "POST",
        body: JSON.stringify({ text: raw, note_id: saved.id, note_date: date }),
      });
      if (d.refined_text) {
        const updated = { ...saved, refined_text: d.refined_text };
        setNote((prev) => (prev && prev.id === saved.id ? updated : prev));
        qc.setQueryData<AuthorNote[]>(AN_KEYS.history(trader), (prev) => upsertHistory(prev, updated));
        setShowAi(true);
        toast({ title: "AI-версия готова" });
      }
    } catch (e) {
      toast({ title: "AI не ответил", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setImproving(false);
    }
  };

  /* ── Delete ── */
  const doDelete = async () => {
    const target = confirmDelete;
    if (!target) return;
    setDeleting(true);
    try {
      await api(`/author-notes/${target.id}`, { method: "DELETE" });
      qc.setQueryData<AuthorNote[]>(AN_KEYS.history(trader), (prev) => prev?.filter((n) => n.id !== target.id));
      void qc.invalidateQueries({ queryKey: ["author-notes", "feed"] });
      if (noteRef.current?.id === target.id) {
        cancelAutosave();
        if (dictation.recording) dictation.stop();
        setNote(null); setRaw(""); setMood(""); setShowAi(false); setStatus("idle"); setSavedAt(null);
      }
      toast({ title: "Сводка удалена" });
      setConfirmDelete(null);
    } catch (e) {
      toast({ title: "Не удалось удалить", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      toast({ title: "Текст скопирован" });
    } catch {
      toast({ title: "Не удалось скопировать", variant: "destructive" });
    }
  };

  /* ── Keyboard ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyS") {
        if (view === "write" && canEdit) { e.preventDefault(); void manualSave(); }
        return;
      }
      if (e.key === "Escape" && dictation.recording) { dictation.stop(); return; }
      // Alt+1…7 jumps to a block, also while typing in another one (e.code: layout-independent).
      if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-7]$/.test(e.code)) {
        const k = sectionForDigit(Number(e.code.slice(5)));
        if (k && view === "write" && canEdit && loadState === "ok") { e.preventDefault(); focusSection(k); }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (e.code === "BracketLeft" && view !== "history") { e.preventDefault(); changeDate(addDays(dateRef.current, -1)); }
      else if (e.code === "BracketRight" && view !== "history") { e.preventDefault(); changeDate(addDays(dateRef.current, 1)); }
      else if (e.code === "KeyN" && canEdit) { e.preventDefault(); setView("write"); setTimeout(() => firstFieldRef.current?.focus(), 50); }
      else if (e.code === "Digit1" && canEdit) setView("write");
      else if (e.code === "Digit2") setView("feed");
      else if (e.code === "Digit3" && canEdit) setView("history");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ── Render ── */
  const dayUnavailable = dayQ.isError && dayQ.error instanceof HttpError && dayQ.error.status === 404;
  const editorDisabled = loadState !== "ok";
  const words = raw.trim() ? raw.trim().split(/\s+/).length : 0;
  const filled = parseNote(raw);
  const filledCount = SECTIONS.filter((s) => filled.sections[s.key].trim()).length;
  const money = moneyMentions(raw);
  const planEmpty = mode === "sections" && filledCount >= 2 && !filled.sections.hold.trim() && !filled.sections.open.trim();

  const viewOptions = [
    ...(canEdit ? [{ value: "write", label: <span className="inline-flex items-center gap-1.5">Запись</span> }] : []),
    {
      value: "feed",
      label: (
        <span className="inline-flex items-center gap-1.5">
          Лента команды
          {unreadCount > 0 && <span className="rounded-full bg-down px-1.5 text-2xs font-semibold tabular-nums text-primary-foreground" aria-label={`${unreadCount} непрочитанных`}>{unreadCount}</span>}
        </span>
      ),
    },
    ...(canEdit ? [{ value: "history", label: "История" }] : []),
  ];

  if (!user || user.role === "guest" || !trader) {
    return (
      <Page>
        <PageHeader title="Сводка автора" icon={NotebookPen} description="Итоги дня от head-трейдера: рынок, сделки, уроки и план на завтра" />
        <Panel>
          <EmptyState icon={NotebookPen} title="Войди, чтобы читать сводки" description="Сводки доступны участникам команды." />
        </Panel>
      </Page>
    );
  }

  const dateNav = view !== "history" && (
    <div className="flex items-center gap-1.5">
      <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Предыдущий день" title="Предыдущий день  [" onClick={() => changeDate(addDays(date, -1))} disabled={dictation.recording}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Input
        type="date"
        aria-label="Дата сводки"
        value={date}
        max={today}
        disabled={dictation.recording}
        onChange={(e) => changeDate(e.target.value)}
        className="h-9 w-[150px] tabular-nums"
      />
      <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Следующий день" title="Следующий день  ]" onClick={() => changeDate(addDays(date, 1))} disabled={date >= today || dictation.recording}>
        <ChevronRight className="h-4 w-4" />
      </Button>
      {date !== today && (
        <Button variant="ghost" size="sm" onClick={() => changeDate(today)} disabled={dictation.recording}>Сегодня</Button>
      )}
    </div>
  );

  return (
    <Page>
      <PageHeader
        title="Сводка автора"
        icon={NotebookPen}
        description="Итоги дня от head-трейдера: рынок, сделки, уроки и план на завтра"
        actions={dateNav}
      >
        <Segmented ariaLabel="Раздел" value={view} onChange={(v) => setView(v as View)} options={viewOptions} />
      </PageHeader>

      {view === "write" && canEdit && (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-4">
            <section className="glass-panel flex flex-col gap-4 rounded-2xl p-4 sm:p-5" aria-labelledby="author-editor-title">
              {/* Header: date + status */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 id="author-editor-title" className="text-lg font-semibold tracking-tight first-letter:uppercase">{fmtDayLong(date)}</h2>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <SaveIndicator status={status} savedAt={savedAt} now={now} onRetry={() => void save({ force: true })} />
                    {audienceQ.data && audienceQ.data.total > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
                        <Eye className="h-3 w-3" aria-hidden="true" />Прочитали {audienceQ.data.read} из {audienceQ.data.total}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Segmented
                    ariaLabel="Режим редактора"
                    size="sm"
                    value={mode}
                    onChange={(m) => setMode(m as EditorMode)}
                    options={[{ value: "sections", label: "Блоки" }, { value: "free", label: "Текст" }]}
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label="Ещё действия" disabled={editorDisabled}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => { setTplName(""); setTplDialog(true); }}>
                        <BookmarkPlus className="mr-2 h-4 w-4" />Сохранить как шаблон
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void copyText()} disabled={!raw.trim()}>
                        <Copy className="mr-2 h-4 w-4" />Копировать текст
                      </DropdownMenuItem>
                      {note && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-down focus:text-down" onSelect={() => setConfirmDelete(note)}>
                            <Trash2 className="mr-2 h-4 w-4" />Удалить сводку
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Mood */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground" id="author-mood-label">Состояние</span>
                <div role="group" aria-labelledby="author-mood-label" className="flex flex-wrap gap-1.5">
                  {MOODS.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      aria-pressed={mood === m.value}
                      disabled={editorDisabled}
                      onClick={() => changeMood(mood === m.value ? "" : m.value)}
                      className="chip inline-flex min-h-8 items-center gap-1.5 px-3 text-sm disabled:opacity-50"
                    >
                      <span aria-hidden="true">{m.emoji}</span>
                      <span className="text-xs">{m.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-2 border-y border-border py-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5" disabled={editorDisabled}>
                      <LayoutTemplate className="h-3.5 w-3.5" aria-hidden="true" />Шаблон
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-72">
                    <DropdownMenuLabel className="text-xs text-muted-foreground">Заполнит только пустые блоки</DropdownMenuLabel>
                    {BUILTIN_TEMPLATES.map((t) => (
                      <DropdownMenuItem key={t.id} onSelect={() => applyTpl(t)} className="flex flex-col items-start gap-0.5">
                        <span className="text-sm font-medium">{t.name}</span>
                        <span className="text-xs text-muted-foreground">{t.description}</span>
                      </DropdownMenuItem>
                    ))}
                    {templates.length > 0 && <DropdownMenuSeparator />}
                    {templates.map((t) => (
                      <div key={t.id} className="flex items-center">
                        <DropdownMenuItem onSelect={() => applyTpl(t)} className="min-w-0 flex-1">
                          <span className="truncate text-sm">{t.name}</span>
                        </DropdownMenuItem>
                        <button
                          type="button"
                          aria-label={`Удалить шаблон ${t.name}`}
                          onClick={() => removeTemplate(t.id)}
                          className="mr-1 grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                {dictation.supported ? (
                  <Button
                    variant={dictation.recording ? "destructive" : "outline"}
                    size="sm"
                    className="gap-1.5"
                    aria-pressed={dictation.recording}
                    disabled={!dictation.recording && editorDisabled}
                    onClick={dictation.recording ? dictation.stop : startDictation}
                  >
                    {dictation.recording ? <MicOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Mic className="h-3.5 w-3.5" aria-hidden="true" />}
                    {dictation.recording ? "Стоп" : "Диктовать"}
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">Голосовой ввод — в Chrome / Edge</span>
                )}
                {dictation.recording && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-down" role="status">
                    <span className="h-2 w-2 rounded-full bg-down motion-safe:animate-pulse" aria-hidden="true" />
                    Пишу в «{activeKey === "free" || !activeKey ? (mode === "free" ? "Текст" : "Общее") : SECTIONS.find((s) => s.key === activeKey)?.label}» · <Kbd>Esc</Kbd>
                  </span>
                )}

                <div className="ml-auto flex items-center gap-2">
                  <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
                    {mode === "sections" ? `${filledCount}/${SECTIONS.length} блоков · ` : ""}{words} сл.
                  </span>
                  <Button size="sm" className="gap-1.5" onClick={() => void improve()} disabled={improving || editorDisabled || !raw.trim()}>
                    {improving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
                    {improving ? "AI обрабатывает…" : "Улучшить с AI"}
                  </Button>
                </div>
              </div>

              {/* Nudges: $ in a team-read note, empty plan */}
              {loadState === "ok" && (money.length > 0 || planEmpty) && (
                <div className="flex flex-col gap-1.5" role="note">
                  {money.length > 0 && (
                    <p className="flex items-start gap-1.5 text-xs text-warn">
                      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>
                        В тексте есть суммы в $ ({money.slice(0, 3).join(", ")}{money.length > 3 ? "…" : ""}) — сводку читает вся команда,
                        для джунов и стажёров лучше в R.
                      </span>
                    </p>
                  )}
                  {planEmpty && (
                    <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                      План на завтра пуст — джуны читают его первым.
                      <button type="button" onClick={() => focusSection("open")} className="font-medium text-primary underline-offset-2 hover:underline">
                        Заполнить
                      </button>
                      <span className="hidden md:inline"><Kbd>Alt</Kbd> <Kbd>7</Kbd></span>
                    </p>
                  )}
                </div>
              )}

              {/* Body */}
              {loadState === "loading" ? (
                <div className="flex flex-col gap-4" aria-busy="true" aria-label="Загрузка сводки">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="flex flex-col gap-2">
                      <Skeleton className="h-4 w-32 rounded-full" />
                      <Skeleton className="h-20 w-full rounded-xl" />
                    </div>
                  ))}
                </div>
              ) : loadState === "error" ? (
                <EmptyState
                  icon={AlertCircle}
                  title="Не удалось загрузить сводку"
                  action={<Button variant="outline" onClick={() => void loadNote(date)}>Повторить</Button>}
                />
              ) : (
                <AuthorEditor
                  raw={raw}
                  mode={mode}
                  onEdit={edit}
                  activeKey={activeKey}
                  onFocusTarget={onFocusTarget}
                  recording={dictation.recording}
                  interim={dictation.interim}
                  horizonCounts={dayQ.data?.summary.byHorizon}
                  firstFieldRef={firstFieldRef}
                />
              )}

              <p className="hidden flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground md:flex">
                <span><Kbd>Ctrl</Kbd> <Kbd>S</Kbd> сохранить</span>
                <span><Kbd>Alt</Kbd> <Kbd>1</Kbd>–<Kbd>7</Kbd> к блоку</span>
                <span><Kbd>[</Kbd> <Kbd>]</Kbd> день назад / вперёд</span>
                <span><Kbd>N</Kbd> к записи</span>
                <span><Kbd>1</Kbd>–<Kbd>3</Kbd> разделы</span>
              </p>
            </section>

            {note?.refined_text && (
              <Panel
                title="AI-версия"
                icon={Sparkles}
                description="Структурированный вариант твоей записи — оригинал не меняется"
                actions={
                  <Button variant="ghost" size="sm" onClick={() => setShowAi((v) => !v)} aria-expanded={showAi}>
                    {showAi ? "Свернуть" : "Показать"}
                  </Button>
                }
              >
                {showAi ? <AuthorMarkdown text={note.refined_text} /> : (
                  <p className="line-clamp-2 text-sm text-muted-foreground">{note.refined_text.replace(/\*\*/g, "")}</p>
                )}
              </Panel>
            )}
          </div>

          <aside className="flex min-w-0 flex-col gap-4" aria-label="Контекст дня">
            {prevPlan && (
              <AuthorPrevPlan
                plan={prevPlan}
                trades={dayQ.data?.trades}
                canInsert={!editorDisabled}
                onInsert={insertFollowThrough}
                onOpenDay={changeDate}
              />
            )}
            <AuthorDayContext
              date={date}
              data={dayQ.data}
              loading={dayQ.isLoading}
              unavailable={dayUnavailable || dayQ.isError}
              canInsert={!editorDisabled}
              onInsertTrades={insertTrades}
              onInsertHeld={insertHeld}
            />
            <AuthorAudience
              hasNote={!!note?.id}
              data={audienceQ.data}
              loading={audienceQ.isLoading}
              error={audienceQ.isError}
            />
            <AuthorWeeklyCard
              trader={trader}
              date={date}
              notes={historyNotes}
              selectedDate={date}
              onPickDate={changeDate}
              canGenerate={canEdit}
              beforeGenerate={flush}
            />
          </aside>
        </div>
      )}

      {view === "feed" && (
        <AuthorFeed anchor={date} me={trader} range={range} onRangeChange={setRange} />
      )}

      {view === "history" && canEdit && (
        <AuthorHistory
          notes={historyNotes}
          loading={historyQ.isLoading}
          error={historyQ.isError}
          onRetry={() => void historyQ.refetch()}
          onOpenInEditor={openInEditor}
          onDelete={(n) => setConfirmDelete(n)}
          canEdit={canEdit}
        />
      )}

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => { if (!o && !deleting) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить сводку?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete ? `Запись за ${fmtDayLong(confirmDelete.note_date)} удалится вместе с AI-версией и отметками «прочитано».` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void doDelete(); }}
              disabled={deleting}
              className="bg-down text-primary-foreground hover:brightness-110"
            >
              {deleting ? "Удаляю…" : "Удалить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={tplDialog} onOpenChange={setTplDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Сохранить как шаблон</DialogTitle>
            <DialogDescription>Заполненные блоки этой сводки станут заготовкой. Шаблоны хранятся в этом браузере.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); saveTemplate(); }}
            className="flex flex-col gap-3"
          >
            <label htmlFor="author-tpl-name" className="text-sm font-medium">Название</label>
            <Input id="author-tpl-name" value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="Например: День ФРС" autoFocus maxLength={40} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setTplDialog(false)}>Отмена</Button>
              <Button type="submit" disabled={!tplName.trim()}>Сохранить</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
