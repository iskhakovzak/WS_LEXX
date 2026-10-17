import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, NotebookPen, PencilLine, Users } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { EmptyState, Page, PageHeader, Panel, Segmented } from "@/components/ds";
import { Kbd } from "@/components/ui/kbd";
import { useToast } from "@/hooks/use-toast";
import {
  api, isUnread, lastTradingDays, localToday, qk, type JuniorNote, type Reminder, type ReviewerInfo,
} from "@/components/notes/junior-lib";
import { JuniorEditor } from "@/components/notes/junior-editor";
import { JuniorHistory } from "@/components/notes/junior-history";
import { JuniorTeam } from "@/components/notes/junior-team";
import { JuniorBanners, JuniorKpis } from "@/components/notes/junior-overview";

type Tab = "today" | "history" | "team";
const TAB_KEY = "ws_lexx_junior_tab";

function initialTab(privileged: boolean): Tab {
  try {
    const p = new URLSearchParams(window.location.search).get("tab");
    if (p === "today" || p === "history" || p === "team") return p;
    if (new URLSearchParams(window.location.search).get("date")) return "today";
    const v = localStorage.getItem(TAB_KEY);
    if (v === "today" || v === "history" || v === "team") return v;
  } catch { /* ignore */ }
  return privileged ? "team" : "today";
}

function initialDate(): string {
  try {
    const d = new URLSearchParams(window.location.search).get("date");
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= localToday()) return d;
  } catch { /* ignore */ }
  // On weekends the summary is about the last trading day.
  return lastTradingDays(localToday(), 1)[0]!;
}

export default function JuniorNotesPage() {
  const { user, isCurator, isAdmin } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const trader = user?.traderName ?? "";
  const isPrivileged = isCurator || isAdmin;

  const [tab, setTabState] = React.useState<Tab>(() => initialTab(isPrivileged));
  const [date, setDate] = React.useState<string>(initialDate);

  const setTab = React.useCallback((t: Tab) => {
    setTabState(t);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* ignore */ }
  }, []);

  // Who the caller reviews: curators/admins — everyone; an academy mentor (even a trader) — their mentees.
  const reviewerQ = useQuery({
    queryKey: qk.reviewer,
    queryFn: () => api<ReviewerInfo>("/junior-notes/reviewer"),
    enabled: !!trader,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const reviewer = reviewerQ.data ?? null;
  const isReviewer = !!reviewer && reviewer.kind !== "none";

  // A mentor who has never picked a tab lands on «Команда» once the reviewer scope is known.
  const autoTabbed = React.useRef(false);
  React.useEffect(() => {
    if (autoTabbed.current || !reviewer) return;
    autoTabbed.current = true;
    if (reviewer.kind === "scoped" && !isPrivileged) {
      let stored: string | null = null;
      try { stored = localStorage.getItem(TAB_KEY); } catch { /* ignore */ }
      const p = new URLSearchParams(window.location.search);
      if (!stored && !p.get("tab") && !p.get("date")) setTabState("team");
    }
  }, [reviewer, isPrivileged]);

  const historyQ = useQuery({
    queryKey: qk.history(trader),
    queryFn: () => api<JuniorNote[]>(`/junior-notes/history?trader=${encodeURIComponent(trader)}&limit=250`),
    enabled: !!trader,
    staleTime: 60_000,
  });
  const history = React.useMemo(() => (Array.isArray(historyQ.data) ? historyQ.data : []), [historyQ.data]);

  const remindersQ = useQuery({
    queryKey: qk.reminders,
    queryFn: () => api<Reminder[]>("/junior-notes/reminders/me"),
    enabled: !!trader,
    staleTime: 60_000,
    retry: false,
  });
  const reminders = (remindersQ.data ?? []).filter((r) => !history.some((n) => n.note_date === r.note_date && n.raw_text?.trim()));
  const unread = history.filter(isUnread);

  const openDay = React.useCallback((d: string) => {
    setDate(d);
    setTab("today");
    document.getElementById("main-content")?.scrollTo({ top: 0, behavior: "smooth" });
  }, [setTab]);

  const dismissReminder = async (id: number) => {
    qc.setQueryData<Reminder[]>(qk.reminders, (prev) => prev?.filter((r) => r.id !== id));
    try { await api(`/junior-notes/reminders/${id}/dismiss`, { method: "POST", json: {} }); }
    catch { toast({ title: "Не удалось скрыть напоминание", variant: "destructive" }); void remindersQ.refetch(); }
  };

  // Global shortcuts: N — today's summary, H — history, T — team (outside text fields).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (document.querySelector("[role=dialog]")) return;
      const k = e.key.toLowerCase();
      if (k === "n" || k === "т") { e.preventDefault(); openDay(localToday()); }
      else if (k === "h" || k === "р") { e.preventDefault(); setTab("history"); }
      else if (k === "t" || k === "е") { e.preventDefault(); setTab("team"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openDay, setTab]);

  if (!trader) {
    return (
      <Page>
        <PageHeader title="Сводка джунов" icon={NotebookPen} />
        <Panel>
          <EmptyState icon={NotebookPen} title="Войди в аккаунт" description="Сводки привязаны к трейдеру — войди, чтобы писать и читать их." />
        </Panel>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Сводка джунов"
        icon={NotebookPen}
        description={
          isReviewer
            ? "Итоги дня джунов: план → сделки → ошибки → уроки. Отвечай по очереди, сверяй со вчерашним фокусом и сделками."
            : "Итоги дня по структуре: план → сделки → ошибки → уроки. Куратор или наставник отвечает и ставит оценку."
        }
        actions={
          <span className="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
            <Kbd>N</Kbd> сегодня <Kbd>H</Kbd> история <Kbd>T</Kbd> команда
          </span>
        }
      >
        <Segmented
          ariaLabel="Раздел сводок"
          value={tab}
          onChange={setTab}
          options={[
            { value: "today", label: <><PencilLine className="h-4 w-4" aria-hidden="true" />Сводка дня</> },
            { value: "history", label: <><BookOpen className="h-4 w-4" aria-hidden="true" />История</>, count: unread.length || undefined },
            { value: "team", label: <><Users className="h-4 w-4" aria-hidden="true" />Команда</> },
          ]}
        />
      </PageHeader>

      <JuniorBanners
        reminders={reminders}
        unread={tab === "today" ? unread.filter((n) => n.note_date !== date) : unread}
        onWrite={openDay}
        onDismiss={(id) => void dismissReminder(id)}
        onOpenUnread={openDay}
      />

      {tab !== "team" && (
        <JuniorKpis
          history={history}
          isLoading={historyQ.isLoading}
          selectedDate={tab === "today" ? date : ""}
          onPickDate={openDay}
          onShowUnread={() => setTab("history")}
        />
      )}

      {tab === "today" && <JuniorEditor trader={trader} date={date} onDateChange={setDate} />}
      {tab === "history" && (
        <JuniorHistory
          history={history}
          isLoading={historyQ.isLoading}
          isError={historyQ.isError}
          onRetry={() => void historyQ.refetch()}
          onOpenInEditor={openDay}
        />
      )}
      {tab === "team" && <JuniorTeam reviewer={reviewer} me={trader} />}
    </Page>
  );
}
