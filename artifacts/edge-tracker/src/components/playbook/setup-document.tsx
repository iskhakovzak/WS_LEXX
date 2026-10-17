/**
 * Setup as a structured document: header → edge strip → thesis (entry / invalidation / targets) → notes →
 * screenshots → linked trades → examples → variants; aside: checklist, edge block, ticker profile, meta.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, CheckCircle2, ChevronRight, Circle, Columns2, Copy, FileText, Folder, Image as ImageIcon, Link as LinkIcon,
  ListChecks, MoreHorizontal, Pencil, StickyNote, Target, Trash2, X,
} from "lucide-react";
import { WriteOnly, useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Pill, StatRow, TermLabel, toneText, type Tone } from "@/components/ds";
import { IconAction, winrateTone } from "@/components/playbook-sub/bits";
import { ScreenshotDisplay } from "@/components/screenshot-fields";
import { PlaybookEdgeBlock } from "@/components/playbook-edge-block";
import { MarkChecklist, ChecklistProbabilityBadge } from "@/components/playbook-checklist-marks";
import { PlaybookAICritiqueButton } from "@/components/playbook-ai-critique";
import { PlaybookRevisionsButton } from "@/components/playbook-revisions";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { invalidatePlaybook } from "./api";
import { http } from "@/lib/api/http";
import { ConfidenceMeter, DocSection, REDACTED_AGG_HINT, RedactedHint, SetupTypePill, TagChips } from "./setup-bits";
import { ExamplesSection } from "./examples-section";
import { LinkedTradesSection } from "./linked-trades-section";
import { SubSetupsSection } from "./sub-setups-section";
import { MoveToFolderButton } from "./move-to-folder";
import { CreateIdeaButton } from "./create-idea-button";
import { SOURCE_LABELS, folderSwatch, isSameLocalDay, timeAgo, type PlaybookEntry, type SetupSummary } from "./model";
import { fmtDate, fmtR, fmtRate, fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";

/* ---------- structured thesis ---------- */

type Block = { key: string; label: string; tone: Tone; lines: string[] };
const HEADINGS: { re: RegExp; key: string; label: string; tone: Tone }[] = [
  { re: /^(тезис|идея|контекст|почему)\b/i, key: "thesis", label: "Тезис", tone: "accent" },
  { re: /^(вход|триггер|условия входа|entry|trigger)\b/i, key: "entry", label: "Вход", tone: "up" },
  { re: /^(инвалидация|стоп|отмена|invalidation|stop)\b/i, key: "invalid", label: "Инвалидация", tone: "down" },
  { re: /^(цел[ьи]|таргет[ыа]?|выход|тейк|targets?|exit)\b/i, key: "targets", label: "Цели", tone: "warn" },
  { re: /^(управление|сопровождение|management|риск)\b/i, key: "mgmt", label: "Управление", tone: "purple" },
];

/** Splits free text into labelled blocks when it uses "Инвалидация: …", "Цели: …" style headings. */
export function structureConditions(text: string | null | undefined): Block[] | null {
  if (!text?.trim()) return null;
  const blocks: Block[] = [];
  let cur: Block | null = null;
  let found = 0;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^[#>*\-•\s]+/, "").trimEnd();
    const m = line.match(/^([^:：]{2,28})[:：]\s*(.*)$/);
    const h = m ? HEADINGS.find((x) => x.re.test(m[1].trim())) : undefined;
    if (m && h) {
      found++;
      cur = { key: `${h.key}-${blocks.length}`, label: h.label, tone: h.tone, lines: m[2] ? [m[2]] : [] };
      blocks.push(cur);
    } else if (raw.trim()) {
      if (!cur) { cur = { key: "intro", label: "Описание", tone: "neutral", lines: [] }; blocks.push(cur); }
      cur.lines.push(raw.trim());
    }
  }
  return found > 0 ? blocks : null;
}

const BLOCK_BAR: Record<Tone, string> = {
  up: "bg-up", down: "bg-down", accent: "bg-primary", warn: "bg-[hsl(var(--chart-3))]", purple: "bg-[hsl(var(--chart-5))]", neutral: "bg-muted-foreground/60",
};

export function ThesisView({ text }: { text: string }) {
  const blocks = structureConditions(text);
  if (!blocks) return <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{text}</p>;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {blocks.map((b) => (
        <div key={b.key} className={cn("relative overflow-hidden rounded-xl bg-[var(--glass-bg)] py-2.5 pl-4 pr-3", (b.key.startsWith("intro") || b.key.startsWith("thesis")) && "sm:col-span-2")}>
          <span className={cn("absolute inset-y-2 left-1.5 w-[3px] rounded-full", BLOCK_BAR[b.tone])} aria-hidden="true" />
          <div className={cn("mb-0.5 text-xs font-medium", toneText(b.tone === "neutral" ? "neutral" : b.tone))}>{b.label}</div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{b.lines.join("\n")}</p>
        </div>
      ))}
    </div>
  );
}

/* ---------- inline editable text section ---------- */

export function InlineTextSection({
  entry, field, title, icon, placeholder, empty, render,
}: {
  entry: PlaybookEntry;
  field: "conditions" | "notes";
  title: string;
  icon: typeof FileText;
  placeholder: string;
  empty: string;
  render?: (text: string) => ReactNode;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { canEdit } = useAuth();
  const value = entry[field] ?? "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  const mut = useMutation({
    mutationFn: (text: string) => http.patch(`/api/playbook/${entry.id}`, { [field]: text || null }),
    onMutate: async (text) => {
      await qc.cancelQueries({ queryKey: ["playbook"] });
      const prev = qc.getQueryData<PlaybookEntry[]>(["playbook"]);
      qc.setQueryData<PlaybookEntry[]>(["playbook"], (old = []) => old.map((e) => (e.id === entry.id ? { ...e, [field]: text || null } : e)));
      setEditing(false);
      return { prev };
    },
    onError: (e: any, _t, ctx) => {
      if (ctx?.prev) qc.setQueryData(["playbook"], ctx.prev);
      setEditing(true);
      toast({ title: "Не удалось сохранить", description: e?.message, variant: "destructive" });
    },
    onSettled: () => invalidatePlaybook(qc, entry.id),
  });

  const save = () => { if (draft !== value) mut.mutate(draft.trim()); else setEditing(false); };

  return (
    <DocSection
      title={title}
      icon={icon}
      actions={canEdit && !editing ? <IconAction aria-label={`Редактировать: ${title}`} onClick={() => setEditing(true)}><Pencil /></IconAction> : undefined}
    >
      {editing ? (
        <div className="space-y-2">
          <Textarea
            aria-label={title}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(14, Math.max(4, draft.split("\n").length + 1))}
            placeholder={placeholder}
            autoFocus
            className="resize-y text-sm"
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.stopPropagation(); setEditing(false); setDraft(value); }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
            }}
          />
          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto text-xs text-muted-foreground">Ctrl+Enter — сохранить, Esc — отмена</span>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(value); }}>Отмена</Button>
            <Button size="sm" variant="outline" onClick={save} disabled={mut.isPending}>Сохранить</Button>
          </div>
        </div>
      ) : value ? (
        render ? render(value) : <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{value}</p>
      ) : canEdit ? (
        <button type="button" onClick={() => setEditing(true)} className="w-full rounded-xl border border-dashed border-border px-3 py-3 text-left text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {empty}
        </button>
      ) : (
        <p className="text-sm text-muted-foreground">—</p>
      )}
    </DocSection>
  );
}

/* ---------- edge strip ---------- */

function EdgeTile({ label, value, tone = "neutral", hint }: { label: string; value: ReactNode; tone?: Tone; hint?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl bg-[var(--glass-bg)] px-3 py-2.5">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className={cn("truncate text-xl font-semibold tabular-nums tracking-tight", toneText(tone))}>{value}</div>
      {hint && <div className="truncate text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function EdgeStrip({ s, onLink }: { s: SetupSummary | undefined; onLink: () => void }) {
  if (!s || s.tradeCount === 0) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-dashed border-border px-4 py-3">
        <Target className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="min-w-0 flex-1 basis-56 text-sm text-muted-foreground">
          Нет сделок по сетапу — edge неизвестен. Привяжите сделки, и здесь появятся win rate, средний R и ожидание.
        </p>
        <Button size="sm" variant="ghost" onClick={onLink}>К сделкам</Button>
      </div>
    );
  }
  const n = s.tradeCount;
  const small = n < 10;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        <EdgeTile label="Сделок" value={n} hint={small ? "мало для выводов" : `${s.wins}W · ${s.losses}L${s.be ? ` · ${s.be} BE` : ""}`} tone={small ? "warn" : "neutral"} />
        <EdgeTile label="Win rate" value={fmtRate(s.winrate)} tone={winrateTone(s.winrate ?? 0, n)} hint="W / (W + L)" />
        <EdgeTile label="Средний R" value={fmtR(s.avgR)} tone={s.avgR == null ? "neutral" : s.avgR > 0 ? "up" : s.avgR < 0 ? "down" : "neutral"} hint={s.rCount < n ? `R есть у ${s.rCount}` : undefined} />
        <EdgeTile label="Ожидание" value={fmtR(s.expectancy)} tone={s.expectancy == null ? "neutral" : s.expectancy > 0 ? "up" : s.expectancy < 0 ? "down" : "neutral"} hint="на сделку" />
        <EdgeTile label="P&L нетто" value={fmtUsd(s.netPnl, { signed: true, decimals: 0 })} tone={s.netPnl == null ? "neutral" : s.netPnl > 0 ? "up" : s.netPnl < 0 ? "down" : "neutral"} hint={s.redacted ? "суммы скрыты" : s.netPnl == null ? "нет P&L" : s.pnlCount < n ? `P&L есть у ${s.pnlCount}` : s.grossPnl != null && s.grossPnl !== s.netPnl ? `брутто ${fmtUsd(s.grossPnl, { signed: true, decimals: 0 })}` : undefined} />
        <EdgeTile
          label="Последняя"
          value={fmtDate(s.lastTradeDate, "dayMonth")}
          hint={isSameLocalDay(s.lastUsedAt) ? "использован сегодня" : timeAgo(s.lastUsedAt) ?? undefined}
        />
      </div>
      {s.edgeDecay && (
        <p className="rounded-xl border border-[hsl(var(--chart-3)/0.3)] bg-[hsl(var(--chart-3)/0.1)] px-3 py-2 text-xs text-[hsl(var(--chart-3))]">
          Edge угасает: последние {commonI18n.t("units.trades", { count: s.recentRCount })} дают {fmtR(s.recentAvgR)} против {fmtR(s.avgR)} за всю историю. Пересмотрите условия входа.
        </p>
      )}
      {s.redacted && <RedactedHint text={REDACTED_AGG_HINT} className="px-1" />}
    </div>
  );
}

/* ---------- document ---------- */

export function SetupDocument({
  entry, allEntries, summary, folders, folderColors, onOpen, onClose, onEdit, onDuplicate, onCreateChild, onDelete, onCompare, onFolderClick,
}: {
  entry: PlaybookEntry;
  allEntries: PlaybookEntry[];
  summary: Map<number, SetupSummary>;
  folders: string[];
  folderColors: Record<string, number>;
  onOpen: (id: number) => void;
  onClose: () => void;
  onEdit: (e: PlaybookEntry) => void;
  onDuplicate: (e: PlaybookEntry) => void;
  onCreateChild: (parent: PlaybookEntry) => void;
  onDelete: (e: PlaybookEntry) => void;
  onCompare: (e: PlaybookEntry) => void;
  onFolderClick: (folder: string | null) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { canEdit, isCurator } = useAuth();
  const topRef = useRef<HTMLDivElement>(null);
  const parent = useMemo(() => (entry.parentId ? allEntries.find((e) => e.id === entry.parentId) ?? null : null), [entry.parentId, allEntries]);
  const s = summary.get(entry.id);
  const checklistText = entry.checklist || parent?.checklist || null;
  const checklistItems = entry.checklist ? entry.checklistItems : null;
  const swatch = folderSwatch(entry.folder, folderColors);

  useEffect(() => { topRef.current?.scrollIntoView({ block: "nearest" }); }, [entry.id]);

  const reviewedMut = useMutation({
    // Reviewer identity comes from the session; the API accepts this from curators/admins only.
    mutationFn: (reviewed: boolean) => http.post(`/api/playbook/${entry.id}/reviewed`, { reviewed }),
    onMutate: async (reviewed) => {
      await qc.cancelQueries({ queryKey: ["playbook"] });
      const prev = qc.getQueryData<PlaybookEntry[]>(["playbook"]);
      qc.setQueryData<PlaybookEntry[]>(["playbook"], (old = []) => old.map((e) => (e.id === entry.id ? { ...e, reviewed } : e)));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["playbook"], ctx.prev); toast({ title: "Не удалось изменить отметку", variant: "destructive" }); },
    onSettled: () => { qc.invalidateQueries({ queryKey: ["playbook"] }); qc.invalidateQueries({ queryKey: ["playbook-children"] }); },
  });

  async function saveScreenshotNotes(newNotes: string) {
    try {
      await http.patch(`/api/playbook/${entry.id}`, { screenshotNotes: newNotes });
      invalidatePlaybook(qc, entry.id);
    } catch {
      toast({ title: "Не удалось сохранить подпись к скриншоту", variant: "destructive" });
    }
  }

  function copyLink() {
    const url = `${window.location.origin}${window.location.pathname}?id=${entry.id}`;
    navigator.clipboard?.writeText(url).then(
      () => toast({ title: "Ссылка скопирована" }),
      () => toast({ title: "Не удалось скопировать ссылку", variant: "destructive" }),
    );
  }

  const scrollToTrades = () => document.getElementById("pb-linked-trades")?.scrollIntoView({ behavior: "smooth", block: "start" });

  const fundamentals: [string, string | number | null][] = [
    ["Сектор", entry.sector], ["Капитализация", entry.marketCap], ["Float", entry.float], ["ADV", entry.adv],
    ["ATR", entry.atr], ["Rel. volume", entry.relativeVolume], ["Beta", entry.beta], ["Short interest, %", entry.shortInterest],
  ];
  const hasFundamentals = fundamentals.some(([, v]) => v != null && v !== "");

  return (
    <article ref={topRef} className="flex min-w-0 scroll-mt-20 flex-col gap-4" aria-labelledby="pb-doc-title" data-entry-id={entry.id}>
      {/* Header */}
      <header className="glass-panel rounded-2xl p-4 sm:p-5">
        <div className="flex items-start gap-2">
          <IconAction aria-label="Назад к списку" onClick={onClose} className="-ml-1 lg:hidden"><ArrowLeft /></IconAction>
          <nav aria-label="Путь" className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <button type="button" onClick={() => onFolderClick(entry.folder)} className="inline-flex min-h-6 items-center gap-1.5 rounded-full px-1.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className={cn("h-2 w-2 rounded-full", swatch.bg)} aria-hidden="true" />
              {entry.folder ?? "Без папки"}
            </button>
            {parent && (
              <>
                <ChevronRight className="h-3 w-3" aria-hidden="true" />
                <button type="button" onClick={() => onOpen(parent.id)} className="min-h-6 truncate rounded-full px-1.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {parent.name}
                </button>
              </>
            )}
          </nav>
          <IconAction aria-label="Закрыть сетап" onClick={onClose} className="hidden lg:inline-grid"><X /></IconAction>
        </div>

        <h2 id="pb-doc-title" className="mt-2 text-2xl font-semibold tracking-tight text-foreground [overflow-wrap:anywhere]">{entry.name}</h2>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <SetupTypePill type={entry.setupType} />
          {entry.ticker && <Pill tone="neutral">{entry.ticker}</Pill>}
          {entry.sourceType && <Pill tone="neutral">{SOURCE_LABELS[entry.sourceType] || entry.sourceType}{entry.sourceId ? ` #${entry.sourceId}` : ""}</Pill>}
          {isCurator ? (
            <button
              type="button"
              aria-pressed={entry.reviewed}
              onClick={() => reviewedMut.mutate(!entry.reviewed)}
              className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={entry.reviewed ? `Проверено${entry.reviewedBy ? ` · ${entry.reviewedBy}` : ""}. Нажмите, чтобы снять` : "Отметить как проверенный (куратор)"}
            >
              <Pill tone={entry.reviewed ? "up" : "neutral"}>
                {entry.reviewed ? <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> : <Circle className="h-3 w-3" aria-hidden="true" />}
                {entry.reviewed ? "Проверено" : "Не проверено"}
              </Pill>
            </button>
          ) : entry.reviewed ? (
            <Pill tone="up"><CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Проверено</Pill>
          ) : (
            <Pill tone="neutral"><Circle className="h-3 w-3" aria-hidden="true" /> Ждёт проверки</Pill>
          )}
          {s?.reviewVerdict === "needs_work" && <Pill tone="warn">Куратор: доработать</Pill>}
          {s?.reviewVerdict === "retired" && <Pill tone="down">Куратор: в архив</Pill>}
          <ConfidenceMeter level={entry.confidenceLevel} showLabel />
        </div>
        {entry.tags && <div className="mt-2"><TagChips tags={entry.tags} /></div>}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <WriteOnly><CreateIdeaButton entry={entry} /></WriteOnly>
          <Button variant="outline" size="sm" className="h-8" onClick={() => onCompare(entry)}>
            <Columns2 className="h-4 w-4" aria-hidden="true" /> Сравнить
          </Button>
          <WriteOnly><MoveToFolderButton entry={entry} folders={folders} folderColors={folderColors} /></WriteOnly>
          <span className="flex items-center gap-1">
            <PlaybookAICritiqueButton playbookId={entry.id} playbookName={entry.name} />
            <PlaybookRevisionsButton playbookId={entry.id} currentSnapshot={entry as unknown as Record<string, unknown>} />
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconAction aria-label="Ещё действия" className="ml-auto"><MoreHorizontal /></IconAction>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {canEdit && <DropdownMenuItem onSelect={() => onEdit(entry)}><Pencil className="h-4 w-4" aria-hidden="true" /> Редактировать <span className="ml-auto text-xs text-muted-foreground">E</span></DropdownMenuItem>}
              {canEdit && <DropdownMenuItem onSelect={() => onDuplicate(entry)}><Copy className="h-4 w-4" aria-hidden="true" /> Дублировать</DropdownMenuItem>}
              {canEdit && <DropdownMenuItem onSelect={() => onCreateChild(entry)}><FileText className="h-4 w-4" aria-hidden="true" /> Новый вариант</DropdownMenuItem>}
              <DropdownMenuItem onSelect={copyLink}><LinkIcon className="h-4 w-4" aria-hidden="true" /> Скопировать ссылку</DropdownMenuItem>
              {canEdit && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => onDelete(entry)} className="text-down focus:text-down"><Trash2 className="h-4 w-4" aria-hidden="true" /> Удалить</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mt-4">
          <EdgeStrip s={s} onLink={scrollToTrades} />
        </div>
      </header>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <InlineTextSection
            entry={entry}
            field="conditions"
            title="Тезис и условия входа"
            icon={Target}
            placeholder={"Тезис: почему это работает\nВход: триггер\nИнвалидация: где идея сломана\nЦели: 1R / 2R / уровень"}
            empty="Опишите тезис, триггер входа, инвалидацию и цели. Строки «Вход:», «Инвалидация:», «Цели:» станут отдельными блоками."
            render={(t) => <ThesisView text={t} />}
          />
          <InlineTextSection
            entry={entry}
            field="notes"
            title="Заметки"
            icon={StickyNote}
            placeholder="Управление позицией, типичные ошибки, нюансы"
            empty="Добавьте заметки: управление позицией, типичные ошибки, нюансы."
          />
          {entry.screenshotUrl && (
            <DocSection title="Скриншоты" icon={ImageIcon}>
              <ScreenshotDisplay urls={entry.screenshotUrl} notes={entry.screenshotNotes} onNotesChange={canEdit ? saveScreenshotNotes : undefined} />
            </DocSection>
          )}
          <LinkedTradesSection entry={entry} />
          <ExamplesSection entryId={entry.id} />
          <SubSetupsSection entry={entry} allEntries={allEntries} summary={summary} onOpen={onOpen} onCreateChild={() => onCreateChild(entry)} />
        </div>

        <aside className="flex min-w-0 flex-col gap-4" aria-label="Чеклист и статистика">
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
                <WriteOnly><Button size="sm" variant="outline" onClick={() => onEdit(entry)}>Добавить чеклист</Button></WriteOnly>
              </div>
            )}
          </DocSection>

          <PlaybookEdgeBlock playbookId={entry.id} />

          {(entry.ticker || hasFundamentals) && (
            <DocSection title={entry.ticker ? `Профиль ${entry.ticker}` : "Профиль бумаги"} icon={Folder}>
              {entry.longName && <p className="mb-1 text-sm text-foreground">{entry.longName}</p>}
              <div className="divide-y divide-border/60">
                {fundamentals.filter(([, v]) => v != null && v !== "").map(([k, v]) => <StatRow key={k} label={<TermLabel text={k} />} value={String(v)} />)}
              </div>
            </DocSection>
          )}

          <div className="px-1 text-xs text-muted-foreground">
            Создан {fmtDate(entry.createdAt, "long")}
            {entry.trader ? ` · ${entry.trader}` : ""}
            {entry.reviewed && entry.reviewedBy ? ` · проверил ${entry.reviewedBy}` : ""}
          </div>
        </aside>
      </div>
    </article>
  );
}
