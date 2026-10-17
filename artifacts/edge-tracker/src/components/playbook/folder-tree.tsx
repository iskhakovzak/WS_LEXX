/** Left pane of the library: collapsible folders with setup rows (or a flat sorted list). */
import { memo } from "react";
import { ArrowDown, ArrowUp, ChevronRight, MoreHorizontal, Palette, Pencil, Plus, Trash2 } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent,
  DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconAction, plural, winrateTone } from "@/components/playbook-sub/bits";
import { toneText } from "@/components/ds";
import { cn } from "@/lib/utils";
import { EdgeMini, Highlight } from "./setup-bits";
import { FOLDER_SWATCHES, PICKER_SWATCH_INDICES, fmtPct, folderSwatch, isSameLocalDay, spaceOf, type PlaybookEntry, type SetupSummary } from "./model";

/** Optional row decorations: the author for personal/shared setups, and a drop-target highlight while dragging an example. */
type RowExtras = { showOwner?: boolean; dropTargetId?: number | null };

export type FolderGroup = { folder: string | null; entries: PlaybookEntry[]; total: number };

export type FolderActions = {
  onNewIn: (folder: string | null) => void;
  onRename: (folder: string) => void;
  onColor: (folder: string, idx: number) => void;
  onMove: (folder: string, delta: -1 | 1) => void;
  /** Absent → no «Удалить папку» (folder delete exists for «Офис» only). */
  onDelete?: (folder: string) => void;
};

const SetupRow = memo(function SetupRow({
  e, selected, s, onSelect, query, depth = 0, showFolder, folderColors, showOwner, dropTargetId,
}: {
  e: PlaybookEntry; selected: boolean; s: SetupSummary | undefined; onSelect: (id: number) => void; query: string; depth?: number;
  showFolder?: boolean; folderColors: Record<string, number>;
} & RowExtras) {
  const today = isSameLocalDay(s?.lastUsedAt);
  return (
    <li>
      <button
        type="button"
        data-setup-row={e.id}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(e.id)}
        className={cn(
          "group flex w-full min-w-0 items-center gap-2 rounded-xl py-1.5 pr-2 text-left transition-colors duration-[var(--dur-1)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          depth ? "pl-9" : "pl-3",
          selected ? "bg-primary/15 text-foreground" : "hover:bg-[var(--glass-hover-bg)]",
          dropTargetId === e.id && "ring-2 ring-primary/70",
        )}
        title={e.name.length > 34 ? e.name : undefined}
      >
        {showFolder && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", folderSwatch(e.folder, folderColors).bg)} aria-hidden="true" />}
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-sm", selected ? "font-semibold" : "font-medium")}>
            <Highlight text={e.name} query={query} />
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <EdgeMini s={s} />
            {showOwner && spaceOf(e) === "personal" && e.trader ? (
              <span className="truncate text-xs text-muted-foreground">· {e.trader}</span>
            ) : e.setupType ? (
              <span className="truncate text-xs text-muted-foreground">· {e.setupType}</span>
            ) : null}
          </span>
        </span>
        {today && <span className="shrink-0 rounded-full bg-primary/15 px-1.5 text-xs text-primary">сегодня</span>}
        {!e.reviewed && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--chart-3))]" title="Не проверен" aria-label="Не проверен" />}
      </button>
    </li>
  );
});

function folderEdge(entries: PlaybookEntry[], summary: Map<number, SetupSummary>) {
  let n = 0, w = 0, l = 0;
  for (const e of entries) {
    const s = summary.get(e.id);
    if (!s) continue;
    n += s.tradeCount; w += s.wins; l += s.losses;
  }
  return { n, wr: w + l > 0 ? w / (w + l) : null };
}

export function FolderTree({
  groups, flat, selectedId, onSelect, openFolders, onToggleFolder, summary, folderColors, childrenOf, query, canEdit, actions, folderOrder,
  showOwner, dropTargetId,
}: RowExtras & {
  groups: FolderGroup[];
  /** When set, render a flat list instead of folders (sorted views, search). */
  flat: PlaybookEntry[] | null;
  selectedId: number | null;
  onSelect: (id: number) => void;
  openFolders: Set<string>;
  onToggleFolder: (key: string) => void;
  summary: Map<number, SetupSummary>;
  folderColors: Record<string, number>;
  childrenOf: Map<number, PlaybookEntry[]>;
  query: string;
  canEdit: boolean;
  actions: FolderActions;
  folderOrder: string[];
}) {
  if (flat) {
    if (flat.length === 0) return <p className="px-3 py-6 text-center text-sm text-muted-foreground">Ничего не найдено</p>;
    return (
      <ul className="space-y-0.5" aria-label="Сетапы">
        {flat.map((e) => (
          <SetupRow key={e.id} e={e} selected={selectedId === e.id} s={summary.get(e.id)} onSelect={onSelect} query={query} showFolder folderColors={folderColors} showOwner={showOwner} dropTargetId={dropTargetId} />
        ))}
      </ul>
    );
  }

  if (groups.length === 0) return <p className="px-3 py-6 text-center text-sm text-muted-foreground">Ничего не найдено</p>;

  return (
    <ul className="space-y-1" aria-label="Папки плейбука">
      {groups.map((g) => {
        const key = g.folder ?? "__unfiled";
        const open = openFolders.has(key) || (selectedId != null && g.entries.some((e) => e.id === selectedId || childrenOf.get(e.id)?.some((c) => c.id === selectedId)));
        const sw = folderSwatch(g.folder, folderColors);
        const edge = folderEdge(g.entries, summary);
        const idx = g.folder ? folderOrder.indexOf(g.folder) : -1;
        const panelId = `pb-folder-${key.replace(/[^\p{L}\p{N}_-]/gu, "_")}`;
        return (
          <li key={key}>
            <div className="group/folder flex items-center gap-1 rounded-xl pr-1 hover:bg-[var(--glass-hover-bg)]">
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => onToggleFolder(key)}
                className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-xl px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-[var(--dur-1)] motion-reduce:transition-none", open && "rotate-90")} aria-hidden="true" />
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", sw.bg)} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground" title={g.folder ?? "Без папки"}>{g.folder ?? "Без папки"}</span>
                {edge.n > 0 && (
                  <span className="hidden shrink-0 text-xs tabular-nums sm:inline" title={`${edge.n} ${plural(edge.n, "сделка", "сделки", "сделок")}`}>
                    <span className={toneText(winrateTone(edge.wr ?? 0, edge.n))}>{fmtPct(edge.wr)}</span>
                  </span>
                )}
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {g.entries.length !== g.total ? `${g.entries.length}/${g.total}` : g.total}
                </span>
              </button>
              {canEdit && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconAction aria-label={`Действия с папкой ${g.folder ?? "Без папки"}`} className="md:opacity-0 md:group-hover/folder:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100">
                      <MoreHorizontal />
                    </IconAction>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onSelect={() => actions.onNewIn(g.folder)}><Plus className="h-4 w-4" aria-hidden="true" /> Новый сетап здесь</DropdownMenuItem>
                    {g.folder && (
                      <>
                        <DropdownMenuItem onSelect={() => actions.onRename(g.folder!)}><Pencil className="h-4 w-4" aria-hidden="true" /> Переименовать</DropdownMenuItem>
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger><Palette className="h-4 w-4" aria-hidden="true" /> Цвет</DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            {PICKER_SWATCH_INDICES.map((i) => (
                              <DropdownMenuItem key={i} onSelect={() => actions.onColor(g.folder!, i)}>
                                <span className={cn("h-3 w-3 rounded-full", FOLDER_SWATCHES[i].bg)} aria-hidden="true" />
                                {FOLDER_SWATCHES[i].label}
                                {folderColors[g.folder!] === i && <span className="ml-auto text-xs text-muted-foreground">✓</span>}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuItem disabled={idx <= 0} onSelect={() => actions.onMove(g.folder!, -1)}><ArrowUp className="h-4 w-4" aria-hidden="true" /> Выше</DropdownMenuItem>
                        <DropdownMenuItem disabled={idx < 0 || idx >= folderOrder.length - 1} onSelect={() => actions.onMove(g.folder!, 1)}><ArrowDown className="h-4 w-4" aria-hidden="true" /> Ниже</DropdownMenuItem>
                        {actions.onDelete && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => actions.onDelete!(g.folder!)} className="text-down focus:text-down"><Trash2 className="h-4 w-4" aria-hidden="true" /> Удалить папку…</DropdownMenuItem>
                          </>
                        )}
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            {open && (
              <ul id={panelId} className="mt-0.5 space-y-0.5 pl-3">
                {g.entries.map((e) => (
                  <SetupRowWithChildren
                    key={e.id}
                    e={e}
                    selectedId={selectedId}
                    summary={summary}
                    onSelect={onSelect}
                    query={query}
                    childrenOf={childrenOf}
                    folderColors={folderColors}
                    showOwner={showOwner}
                    dropTargetId={dropTargetId}
                  />
                ))}
                {g.entries.length === 0 && <li className="px-3 py-1.5 text-xs text-muted-foreground">Нет сетапов под фильтр</li>}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SetupRowWithChildren({
  e, selectedId, summary, onSelect, query, childrenOf, folderColors, showOwner, dropTargetId,
}: RowExtras & {
  e: PlaybookEntry; selectedId: number | null; summary: Map<number, SetupSummary>; onSelect: (id: number) => void; query: string;
  childrenOf: Map<number, PlaybookEntry[]>; folderColors: Record<string, number>;
}) {
  const kids = childrenOf.get(e.id) ?? [];
  return (
    <>
      <SetupRow e={e} selected={selectedId === e.id} s={summary.get(e.id)} onSelect={onSelect} query={query} folderColors={folderColors} showOwner={showOwner} dropTargetId={dropTargetId} />
      {kids.map((c) => (
        <SetupRow key={c.id} e={c} depth={1} selected={selectedId === c.id} s={summary.get(c.id)} onSelect={onSelect} query={query} folderColors={folderColors} showOwner={showOwner} dropTargetId={dropTargetId} />
      ))}
    </>
  );
}
