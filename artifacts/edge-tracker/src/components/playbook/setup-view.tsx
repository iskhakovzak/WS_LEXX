/**
 * Setup card (right column of the playbook): header with space / author / sharing state and actions,
 * one status line of $ stats, and tabs «Описание · Эталоны · Статистика · История».
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowUpFromLine, Building2, CheckCircle2, ChevronRight, Circle, Columns2, Copy, CopyPlus, FileText, History,
  Link as LinkIcon, ListChecks, MoreHorizontal, Pencil, Plus, Send, Share2, Trash2, Trophy, Undo2, User, Users, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Pill, SectionTabs, StatRow, TermLabel, toneText } from "@/components/ds";
import { IconAction } from "@/components/playbook-sub/bits";
import { MarkChecklist, ChecklistProbabilityBadge } from "@/components/playbook-checklist-marks";
import { PlaybookEdgeBlock } from "@/components/playbook-edge-block";
import { PlaybookAICritiqueButton } from "@/components/playbook-ai-critique";
import { PlaybookRevisionsButton } from "@/components/playbook-revisions";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { BASE } from "@/lib/api";
import { cn } from "@/lib/utils";
import { invalidatePlaybook, notLiveMessage, pbRequest, useSetupExamples } from "./api";
import { ConfidenceMeter, DocSection, REDACTED_AGG_HINT, SetupTypePill, TagChips } from "./setup-bits";
import { ExamplesBoard } from "./examples-board";
import { ExamplesSection } from "./examples-section";
import { LinkedTradesSection } from "./linked-trades-section";
import { SubSetupsSection } from "./sub-setups-section";
import { MoveToFolderButton } from "./move-to-folder";
import { SetupStatsPanel } from "./setup-stats";
import { StructuredDescription } from "./structured-editor";
import {
  HORIZON_LABEL, SOURCE_LABELS, accessOf, ddmm, fmtPct, fmtR, fmtUsd, folderSwatch, moneyTone, timeAgo,
  type PlaybookEntry, type SetupAccess, type SetupSummary, type ViewerLike,
} from "./model";

export type SetupTab = "about" | "examples" | "stats" | "history";
export const SETUP_TABS: SetupTab[] = ["about", "examples", "stats", "history"];

export function SetupView({
  entry, allEntries, summary, folders, folderColors, viewer, live, tab, onTab,
  onOpen, onClose, onEdit, onDuplicate, onCreateChild, onDelete, onCompare, onFolderClick, onAddExamples, onShare,
}: {
  entry: PlaybookEntry;
  allEntries: PlaybookEntry[];
  summary: Map<number, SetupSummary>;
  folders: string[];
  folderColors: Record<string, number>;
  viewer: ViewerLike;
  /** New API is running (spaces / examples / stats endpoints exist). */
  live: boolean;
  tab: SetupTab;
  onTab: (t: SetupTab) => void;
  onOpen: (id: number) => void;
  onClose: () => void;
  onEdit: (e: PlaybookEntry) => void;
  onDuplicate: (e: PlaybookEntry) => void;
  onCreateChild: (parent: PlaybookEntry) => void;
  onDelete: (e: PlaybookEntry) => void;
  onCompare: (e: PlaybookEntry) => void;
  onFolderClick: (folder: string | null) => void;
  onAddExamples: (e: PlaybookEntry) => void;
  onShare: (e: PlaybookEntry) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { isCurator } = useAuth();
  const topRef = React.useRef<HTMLDivElement>(null);
  const access = accessOf(entry, viewer);
  const parent = React.useMemo(() => (entry.parentId ? allEntries.find((e) => e.id === entry.parentId) ?? null : null), [entry.parentId, allEntries]);
  const s = summary.get(entry.id);
  const examplesQ = useSetupExamples(entry.id, live);
  const exampleCount = examplesQ.data?.length ?? s?.exampleCount;
  const tier1 = examplesQ.data ? examplesQ.data.filter((x) => x.tier === 1).length : s?.tier1Count;
  const swatch = folderSwatch(entry.folder, folderColors);
  const moveTargets = React.useMemo(() => allEntries.filter((e) => accessOf(e, viewer).canAddExamples), [allEntries, viewer]);

  React.useEffect(() => { topRef.current?.scrollIntoView({ block: "nearest" }); }, [entry.id]);

  const reviewedMut = useMutation({
    mutationFn: (reviewed: boolean) => pbRequest(`/api/playbook/${entry.id}/reviewed`, { method: "POST", json: { reviewed } }),
    onMutate: async (reviewed) => {
      await qc.cancelQueries({ queryKey: ["playbook"] });
      const prev = qc.getQueryData<PlaybookEntry[]>(["playbook"]);
      qc.setQueryData<PlaybookEntry[]>(["playbook"], (old = []) => old.map((e) => (e.id === entry.id ? { ...e, reviewed } : e)));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["playbook"], ctx.prev); toast({ title: "Не удалось изменить отметку", variant: "destructive" }); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["playbook"] }),
  });

  const action = useMutation({
    mutationFn: async (kind: "copy" | "propose" | "unpropose" | "promote") => {
      if (kind === "copy") return pbRequest<{ id: number; name: string }>(`/api/playbook/${entry.id}/copy`, { method: "POST", json: {} });
      if (kind === "propose") return pbRequest(`/api/playbook/${entry.id}/propose`, { method: "POST", json: {} });
      if (kind === "unpropose") return pbRequest(`/api/playbook/${entry.id}/propose`, { method: "DELETE" });
      return pbRequest<{ id: number }>(`/api/playbook/${entry.id}/promote`, { method: "POST", json: {} });
    },
    onSuccess: (r: any, kind) => {
      invalidatePlaybook(qc, entry.id);
      if (kind === "copy") { toast({ title: "Скопировано в «Мой»", description: "Автор оригинала сохранён в карточке." }); if (r?.id) onOpen(r.id); }
      if (kind === "propose") toast({ title: "Предложено в Офис", description: "Куратор увидит сетап в списке предложений." });
      if (kind === "unpropose") toast({ title: "Предложение отозвано" });
      if (kind === "promote") { toast({ title: "Сетап добавлен в Офис", description: "Копия с эталонами — оригинал остаётся у автора." }); if (r?.id) onOpen(r.id); }
    },
    onError: (e) => toast({ title: "Не получилось", description: notLiveMessage(e) ?? (e as Error)?.message, variant: "destructive" }),
  });

  function copyLink() {
    const url = `${window.location.origin}${window.location.pathname}?id=${entry.id}`;
    navigator.clipboard?.writeText(url).then(
      () => toast({ title: "Ссылка скопирована" }),
      () => toast({ title: "Не удалось скопировать ссылку", variant: "destructive" }),
    );
  }

  const author = access.space === "office" ? null : entry.trader ?? entry.createdBy ?? null;
  const proposed = !!entry.officeProposedAt;
  const canCopy = live && !access.mine && viewer.canEdit && !!viewer.name;

  return (
    <article ref={topRef} className="flex min-w-0 scroll-mt-20 flex-col gap-[var(--grid-gap)]" aria-labelledby="pb-doc-title" data-entry-id={entry.id}>
      <header className="glass-panel rounded-2xl p-[var(--panel-p)]">
        <div className="flex items-start gap-2">
          <IconAction aria-label="Назад к списку" onClick={onClose} className="-ml-1 lg:hidden"><ArrowLeft /></IconAction>
          <nav aria-label="Путь" className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <SpaceBadge access={access} author={author} />
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
            <button type="button" onClick={() => onFolderClick(entry.folder)} className="inline-flex min-h-6 items-center gap-1.5 rounded-full px-1.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className={cn("h-2 w-2 rounded-full", swatch.bg)} aria-hidden="true" />
              {entry.folder ?? "Без папки"}
            </button>
            {parent && (
              <>
                <ChevronRight className="h-3 w-3" aria-hidden="true" />
                <button type="button" onClick={() => onOpen(parent.id)} className="min-h-6 truncate rounded-full px-1.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{parent.name}</button>
              </>
            )}
          </nav>
          <IconAction aria-label="Закрыть сетап" onClick={onClose} className="hidden lg:inline-grid"><X /></IconAction>
        </div>

        <h2 id="pb-doc-title" className="mt-2 text-2xl font-semibold tracking-tight text-foreground [overflow-wrap:anywhere]">{entry.name}</h2>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <SetupTypePill type={entry.setupType} />
          {entry.horizon && <Pill tone="neutral">{HORIZON_LABEL[entry.horizon] ?? entry.horizon}</Pill>}
          {entry.timeOfDay && <Pill tone="neutral">{entry.timeOfDay}</Pill>}
          {entry.ticker && <Pill tone="neutral">{entry.ticker}</Pill>}
          {access.shared && <Pill tone="accent"><Users className="h-3 w-3" aria-hidden="true" /> {entry.visibility === "all" ? "Открыт офису" : "Открыт выбранным"}</Pill>}
          {proposed && access.space === "personal" && <Pill tone="warn"><Send className="h-3 w-3" aria-hidden="true" /> Предложен в Офис</Pill>}
          {entry.copiedFromAuthor && <Pill tone="neutral" title={entry.copiedFromId ? `Копия сетапа #${entry.copiedFromId}` : undefined}>Копия · {entry.copiedFromAuthor}</Pill>}
          {entry.sourceType && <Pill tone="neutral">{SOURCE_LABELS[entry.sourceType] || entry.sourceType}</Pill>}
          {access.space === "office" && (isCurator ? (
            <button
              type="button"
              aria-pressed={entry.reviewed}
              onClick={() => reviewedMut.mutate(!entry.reviewed)}
              className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={entry.reviewed ? `Проверено${entry.reviewedBy ? ` · ${entry.reviewedBy}` : ""}. Нажмите, чтобы снять` : "Отметить как проверенный"}
            >
              <Pill tone={entry.reviewed ? "up" : "neutral"}>
                {entry.reviewed ? <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> : <Circle className="h-3 w-3" aria-hidden="true" />}
                {entry.reviewed ? "Проверено" : "Не проверено"}
              </Pill>
            </button>
          ) : entry.reviewed ? <Pill tone="up"><CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Проверено</Pill> : null)}
          <ConfidenceMeter level={entry.confidenceLevel} showLabel />
        </div>
        {entry.tags && <div className="mt-2"><TagChips tags={entry.tags} /></div>}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {access.canAddExamples && live && (
            <Button size="sm" onClick={() => onAddExamples(entry)}><Plus className="h-4 w-4" aria-hidden="true" /> Добавить примеры</Button>
          )}
          {access.canShare && live && (
            <Button size="sm" variant="outline" onClick={() => onShare(entry)}><Share2 className="h-4 w-4" aria-hidden="true" /> {access.shared ? "Доступ" : "Поделиться"}</Button>
          )}
          {canCopy && (
            <Button size="sm" variant="outline" onClick={() => action.mutate("copy")} disabled={action.isPending}><CopyPlus className="h-4 w-4" aria-hidden="true" /> В «Мой»</Button>
          )}
          {live && access.mine && !access.canPromote && (
            proposed
              ? <Button size="sm" variant="ghost" onClick={() => action.mutate("unpropose")} disabled={action.isPending}><Undo2 className="h-4 w-4" aria-hidden="true" /> Отозвать из Офиса</Button>
              : <Button size="sm" variant="ghost" onClick={() => action.mutate("propose")} disabled={action.isPending}><Send className="h-4 w-4" aria-hidden="true" /> Предложить в Офис</Button>
          )}
          {live && access.canPromote && (
            <Button size="sm" variant="outline" onClick={() => action.mutate("promote")} disabled={action.isPending} title="Копия с эталонами появится в «Офис»">
              <ArrowUpFromLine className="h-4 w-4" aria-hidden="true" /> В Офис
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => onCompare(entry)}><Columns2 className="h-4 w-4" aria-hidden="true" /> Сравнить</Button>
          {access.canEdit && <MoveToFolderButton entry={entry} folders={folders} folderColors={folderColors} />}
          <span className="ml-auto flex items-center gap-1">
            {access.canEdit && <PlaybookAICritiqueButton playbookId={entry.id} playbookName={entry.name} />}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconAction aria-label="Ещё действия"><MoreHorizontal /></IconAction>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {access.canEdit && <DropdownMenuItem onSelect={() => onEdit(entry)}><Pencil className="h-4 w-4" aria-hidden="true" /> Редактировать всё <span className="ml-auto text-xs text-muted-foreground">E</span></DropdownMenuItem>}
                {viewer.canEdit && <DropdownMenuItem onSelect={() => onDuplicate(entry)}><Copy className="h-4 w-4" aria-hidden="true" /> Дублировать</DropdownMenuItem>}
                {access.canEdit && <DropdownMenuItem onSelect={() => onCreateChild(entry)}><FileText className="h-4 w-4" aria-hidden="true" /> Новый вариант</DropdownMenuItem>}
                <DropdownMenuItem onSelect={copyLink}><LinkIcon className="h-4 w-4" aria-hidden="true" /> Скопировать ссылку</DropdownMenuItem>
                {access.canEdit && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => onDelete(entry)} className="text-down focus:text-down"><Trash2 className="h-4 w-4" aria-hidden="true" /> Удалить</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </div>

        <StatusLine s={s} exampleCount={exampleCount} tier1={tier1} onStats={() => onTab("stats")} onExamples={() => onTab("examples")} />
      </header>

      <SectionTabs<SetupTab>
        ariaLabel="Разделы сетапа"
        value={tab}
        onChange={onTab}
        tabs={[
          { value: "about", label: "Описание", icon: FileText },
          { value: "examples", label: "Эталоны", icon: Trophy, count: exampleCount || undefined },
          { value: "stats", label: "Статистика", icon: ListChecks },
          { value: "history", label: "История изменений", icon: History },
        ]}
      />

      <div className="min-h-[420px]">
        {tab === "about" && (
          <div className="flex flex-col gap-[var(--grid-gap)]">
            <StructuredDescription entry={entry} canEdit={access.canEdit} live={live} aside={<AboutAside entry={entry} parent={parent} access={access} onEdit={onEdit} />} />
            <SubSetupsSection entry={entry} allEntries={allEntries} summary={summary} onOpen={onOpen} onCreateChild={() => onCreateChild(entry)} />
          </div>
        )}
        {tab === "examples" && (
          <div className="flex flex-col gap-[var(--grid-gap)]">
            {live ? (
              <ExamplesBoard entry={entry} access={access} viewerName={viewer.name} targets={moveTargets} onAddExamples={() => onAddExamples(entry)} />
            ) : (
              <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">Доска эталонов (Tier 1/2/3) включится после обновления сервера.</p>
            )}
            <ExamplesSection entryId={entry.id} />
          </div>
        )}
        {tab === "stats" && (
          <SetupStatsPanel setupId={entry.id} summary={s}>
            <LinkedTradesSection entry={entry} />
            <details className="glass-panel rounded-2xl p-[var(--panel-p)]">
              <summary className="cursor-pointer text-sm font-semibold text-foreground">Edge по условиям (R, VIX, оценка сетапа)</summary>
              <div className="mt-3"><PlaybookEdgeBlock playbookId={entry.id} /></div>
            </details>
          </SetupStatsPanel>
        )}
        {tab === "history" && <HistoryPanel entry={entry} />}
      </div>
    </article>
  );
}

/* ───────────────────────── pieces ───────────────────────── */

function SpaceBadge({ access, author }: { access: SetupAccess; author: string | null }) {
  if (access.space === "office") return <span className="inline-flex items-center gap-1 font-medium text-foreground"><Building2 className="h-3.5 w-3.5" aria-hidden="true" /> Офис</span>;
  if (access.mine) return <span className="inline-flex items-center gap-1 font-medium text-foreground"><User className="h-3.5 w-3.5" aria-hidden="true" /> Мой</span>;
  return <span className="inline-flex items-center gap-1 font-medium text-foreground"><Users className="h-3.5 w-3.5" aria-hidden="true" /> {author ?? "Трейдер"}</span>;
}

/** One line instead of a row of empty KPI tiles. */
function StatusLine({
  s, exampleCount, tier1, onStats, onExamples,
}: { s: SetupSummary | undefined; exampleCount?: number; tier1?: number; onStats: () => void; onExamples: () => void }) {
  const ex = (
    <button type="button" onClick={onExamples} className="hover:text-foreground">
      эталонов {exampleCount ?? 0}{tier1 ? ` · T1 ${tier1}` : ""}
    </button>
  );
  if (!s || s.tradeCount === 0) {
    return (
      <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-3 text-sm text-muted-foreground">
        <span>Сделок по сетапу пока нет — edge неизвестен</span>
        <span aria-hidden="true">·</span>
        {ex}
      </p>
    );
  }
  const exp = s.expectancyUsd ?? (s.netPnl != null && s.tradeCount ? s.netPnl / s.tradeCount : null);
  return (
    <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-3 text-sm tabular-nums text-muted-foreground">
      <button type="button" onClick={onStats} className="hover:text-foreground">{s.tradeCount} сделок{s.tradeCount < 10 ? " (мало для выводов)" : ""}</button>
      <span aria-hidden="true">·</span>
      <span>WR <span className="text-foreground">{fmtPct(s.winrate)}</span></span>
      <span aria-hidden="true">·</span>
      {s.redacted ? (
        // $ hidden by the server (other traders' trades) → expectancy in R instead.
        <span title={REDACTED_AGG_HINT}><span className={toneText(moneyTone(s.expectancy))}>{fmtR(s.expectancy)}</span> / сделка · суммы скрыты</span>
      ) : (
        <>
          <span>нетто <span className={toneText(moneyTone(s.netPnl))}>{fmtUsd(s.netPnl)}</span></span>
          <span aria-hidden="true">·</span>
          <span><span className={toneText(moneyTone(exp))}>{fmtUsd(exp, 2)}</span> / сделка</span>
        </>
      )}
      <span aria-hidden="true">·</span>
      {ex}
      {s.lastTradeDate && (<><span aria-hidden="true">·</span><span>последняя {ddmm(s.lastTradeDate)}</span></>)}
    </p>
  );
}

function AboutAside({ entry, parent, access, onEdit }: { entry: PlaybookEntry; parent: PlaybookEntry | null; access: SetupAccess; onEdit: (e: PlaybookEntry) => void }) {
  const checklistText = entry.checklist || parent?.checklist || null;
  const checklistItems = entry.checklist ? entry.checklistItems : null;
  const fundamentals: [string, string | number | null][] = [
    ["Сектор", entry.sector], ["Капитализация", entry.marketCap], ["Float", entry.float], ["ADV", entry.adv],
    ["ATR", entry.atr], ["Rel. volume", entry.relativeVolume], ["Beta", entry.beta], ["Short interest, %", entry.shortInterest],
  ];
  const hasFundamentals = fundamentals.some(([, v]) => v != null && v !== "");
  return (
    <>
      <DocSection
        title="Чеклист"
        icon={ListChecks}
        actions={checklistText ? <ChecklistProbabilityBadge playbookId={entry.id} items={checklistItems} text={checklistText} /> : undefined}
      >
        {checklistText ? (
          <>
            {!entry.checklist && parent?.checklist && <p className="mb-2 text-xs text-muted-foreground">Унаследован от «{parent.name}»</p>}
            <MarkChecklist playbookId={entry.id} items={checklistItems} text={checklistText} />
          </>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Чеклиста нет. Короткий список условий помогает не входить в «почти тот же» сетап.</p>
            {access.canEdit && <Button size="sm" variant="outline" onClick={() => onEdit(entry)}>Добавить чеклист</Button>}
          </div>
        )}
      </DocSection>
      {(entry.ticker || hasFundamentals) && (
        <DocSection title={entry.ticker ? `Профиль ${entry.ticker}` : "Профиль бумаги"}>
          {entry.longName && <p className="mb-1 text-sm text-foreground">{entry.longName}</p>}
          <div className="divide-y divide-border/60">
            {fundamentals.filter(([, v]) => v != null && v !== "").map(([k, v]) => <StatRow key={k} label={<TermLabel text={k} />} value={String(v)} />)}
          </div>
        </DocSection>
      )}
    </>
  );
}

type ActivityRow = { id: number; action: string; section: string; entityId?: string | null; entityTitle?: string; trader?: string; details?: string; createdAt: string };

function HistoryPanel({ entry }: { entry: PlaybookEntry }) {
  const q = useQuery<ActivityRow[]>({
    queryKey: ["playbook-activity", "setup", entry.id],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/activity`);
      if (!r.ok) return [];
      const all = (await r.json().catch(() => [])) as ActivityRow[];
      return (Array.isArray(all) ? all : [])
        .filter((a) => a.section === "playbook" && (String(a.entityId ?? "") === String(entry.id) || (!a.entityId && a.entityTitle === entry.name)))
        .slice(0, 50);
    },
    staleTime: 30_000,
  });
  const facts: [string, string][] = [
    ["Создан", `${new Date(entry.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}${entry.createdBy ? ` · ${entry.createdBy}` : entry.trader ? ` · ${entry.trader}` : ""}`],
  ];
  if (entry.updatedAt) facts.push(["Изменён", timeAgo(entry.updatedAt) ?? ""]);
  if (entry.copiedFromAuthor) facts.push(["Скопирован у", `${entry.copiedFromAuthor}${entry.copiedFromId ? ` (#${entry.copiedFromId})` : ""}`]);
  if (entry.promotedFromId) facts.push(["Перенесён в Офис из", `#${entry.promotedFromId}`]);
  if (entry.sharedAt && entry.visibility && entry.visibility !== "private") facts.push(["Открыт", `${new Date(entry.sharedAt).toLocaleDateString("ru-RU")}${entry.sharedBy ? ` · ${entry.sharedBy}` : ""}`]);
  if (entry.officeProposedAt) facts.push(["Предложен в Офис", `${new Date(entry.officeProposedAt).toLocaleDateString("ru-RU")}${entry.officeProposedBy ? ` · ${entry.officeProposedBy}` : ""}`]);
  if (entry.reviewed && entry.reviewedBy) facts.push(["Проверил", entry.reviewedBy]);

  return (
    <div className="grid gap-[var(--grid-gap)] xl:grid-cols-[minmax(0,1fr)_340px]">
      <DocSection title="Журнал" icon={History} actions={<PlaybookRevisionsButton playbookId={entry.id} currentSnapshot={entry as unknown as Record<string, unknown>} />}>
        {q.isLoading ? (
          <div className="flex flex-col gap-2">{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-[var(--glass-bg)] motion-reduce:animate-none" />)}</div>
        ) : !q.data?.length ? (
          <p className="text-sm text-muted-foreground">Записей пока нет. Версии текста — по кнопке «История» справа сверху.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {q.data.map((a) => (
              <li key={a.id} className="flex items-start gap-3 text-sm">
                <span className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">{new Date(a.createdAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}</span>
                <span className="min-w-0 flex-1">
                  <span className="text-foreground">{a.details || ACTION_LABEL[a.action] || a.action}</span>
                  {a.trader && <span className="text-muted-foreground"> · {a.trader}</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </DocSection>
      <DocSection title="Происхождение">
        <div className="divide-y divide-border/60">
          {facts.map(([k, v]) => <StatRow key={k} label={k} value={v} />)}
        </div>
      </DocSection>
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = { created: "Создан", updated: "Изменён", deleted: "Удалён", restored: "Восстановлен" };
