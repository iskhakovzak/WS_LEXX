/**
 * The playbook over the current page (lazy chunk, opened through components/shared/playbook-sheet):
 *   «setup» — search the office setups (code, name, «ORB»), grouped by window, → the one-screen cheat sheet;
 *   «tag»   — «Разметить сделки»: the playbook inbox (own trades without a setup) — the evening card's step.
 * Right sheet on desktop, bottom sheet on phones.
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, ExternalLink, Lock, Search } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-error";
import type { PlaybookSheetRequest } from "@/components/shared/playbook-sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/contexts/auth-context";
import type { PlaybookToday, TodaySetup } from "@/lib/playbook-today/types";
import { cn } from "@/lib/utils";
import { playbookTodayI18n } from "@/i18n/ns/playbookToday";
import { UsageMark } from "@/components/shared/usage-tracker";
import { PlaybookInbox } from "../home";
import { CheatCard } from "./cheat-card";
import { SetupSchema } from "./schema-art";
import { matchSetup, windowSetups } from "./today-model";
import { edgeChip, timeText, unlockText, windowLabel } from "./today-text";
import { usePlaybookToday } from "./use-today";

export type QuickSheetRequest = PlaybookSheetRequest & { n: number };

function SetupSearch({ today, initialQuery, onPick }: { today: PlaybookToday; initialQuery: string; onPick: (id: number) => void }) {
  const { t } = playbookTodayI18n.useT();
  const [q, setQ] = useState(initialQuery);
  const groups = useMemo(
    () => today.windows.map((w) => ({ w, list: windowSetups(today, w).filter((s) => matchSetup(s, q)) })).filter((g) => g.list.length),
    [today, q],
  );
  const first = groups[0]?.list[0];
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && first) { e.preventDefault(); onPick(first.id); } }}
          placeholder={t("sheet.search")}
          aria-label={t("sheet.search")}
          className="h-10 pl-9"
        />
      </div>
      {groups.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("sheet.empty")}</p>
      ) : (
        groups.map(({ w, list }) => (
          <section key={w.key} aria-label={windowLabel(w.key)}>
            <h3 className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-foreground/70">{windowLabel(w.key)} · {w.from}–{w.to}</h3>
            <ul className="flex flex-col gap-0.5">
              {list.map((s) => <QuickRow key={s.id} s={s} onPick={onPick} />)}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function QuickRow({ s, onPick }: { s: TodaySetup; onPick: (id: number) => void }) {
  const chip = edgeChip(s.myEdge);
  const trader = useAuth().user?.role === "trader";
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(s.id)}
        className={cn("flex min-h-11 w-full min-w-0 items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", s.locked && "opacity-75")}
      >
        <SetupSchema schema={s.schema} className="h-9 w-[60px] self-start" title="" />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium leading-snug text-foreground [overflow-wrap:anywhere]">{s.name}</span>
          <span className="block text-sm text-foreground/75">
            {s.locked ? <><Lock className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-warn" aria-hidden="true" />{unlockText(s)}</> : trader ? `${timeText(s)} · ${chip.text}` : timeText(s)}
          </span>
        </span>
      </button>
    </li>
  );
}

function SetupPane({ request, onClose }: { request: Extract<QuickSheetRequest, { kind: "setup" }>; onClose: () => void }) {
  const { t } = playbookTodayI18n.useT();
  const [, navigate] = useLocation();
  const trader = useAuth().user?.role === "trader";
  const q = usePlaybookToday();
  const today = q.data ?? null;
  const [picked, setPicked] = useState<number | null>(request.setupId ?? null);
  useEffect(() => { setPicked(request.setupId ?? null); }, [request.n, request.setupId]);
  // «ORB» from the palette with exactly one hit → straight to the card.
  useEffect(() => {
    if (!today || request.setupId || !request.query) return;
    const hits = today.setups.filter((s) => matchSetup(s, request.query ?? ""));
    if (hits.length === 1) setPicked(hits[0].id);
  }, [today, request.n, request.query, request.setupId]);
  if (q.isLoading) return <div className="flex flex-col gap-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-11 rounded-xl" />)}</div>;
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} message={t("loadFailed")} />;
  if (!today) return <p className="text-sm text-muted-foreground">{t("notLive")}</p>;
  const setup = picked ? today.setups.find((s) => s.id === picked) ?? null : null;
  if (!setup) return <SetupSearch today={today} initialQuery={request.query ?? ""} onPick={setPicked} />;
  const openPage = () => { onClose(); navigate(`/playbook?id=${setup.id}`); };
  return (
    <div className="flex flex-col gap-2">
      <UsageMark action="playbook.cheat" meta={{ code: setup.code }} />
      <button type="button" onClick={() => setPicked(null)} className="inline-flex min-h-9 items-center gap-1.5 self-start rounded-lg px-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t("sheet.back")}
      </button>
      <CheatCard
        key={setup.id}
        setup={setup}
        oneR={today.oneR}
        date={today.date}
        narrow
        onLeave={onClose}
        showEdge={trader}
        className="p-3 sm:p-4"
        actions={
          <button type="button" onClick={openPage} title={t("card.full")} aria-label={t("card.full")} className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </button>
        }
      />
    </div>
  );
}

export default function PlaybookQuickSheet({ request, open, onOpenChange }: { request: QuickSheetRequest; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = playbookTodayI18n.useT();
  const mobile = useIsMobile();
  const tag = request.kind === "tag";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={mobile ? "bottom" : "right"}
        className={cn("flex flex-col gap-4 p-4 sm:p-5", mobile ? "max-h-[92dvh] rounded-t-2xl" : tag ? "w-full sm:max-w-3xl" : "w-full sm:max-w-2xl")}
      >
        <SheetHeader>
          <SheetTitle>{tag ? t("tagSheet.title") : t("sheet.title")}</SheetTitle>
          <SheetDescription>{tag ? t("tagSheet.description") : t("sheet.description")}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1">
          {request.kind === "tag" ? <PlaybookInbox key={`${request.n}-${request.day ?? ""}`} day={request.day ?? null} /> : <SetupPane request={request} onClose={() => onOpenChange(false)} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
