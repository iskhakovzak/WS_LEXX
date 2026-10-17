import * as React from "react";
import {
  MoreHorizontal, Lightbulb, ArrowRightLeft, RefreshCw, Pencil, Trash2, PanelRightOpen, Archive, ArchiveRestore, ClipboardList, CornerDownRight,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { LISTS, LIST_LABELS, type ListName, type WatchlistItem } from "./lib";

/** Everything a row / the detail sheet can do with a ticker. The page owns the implementations. */
export type RowActions = {
  open: (item: WatchlistItem) => void;
  moveTo: (items: WatchlistItem[], list: ListName) => void;
  archive: (items: WatchlistItem[]) => void;
  restore: (item: WatchlistItem, list?: ListName) => void;
  createIdea: (item: WatchlistItem, thenTrade?: boolean) => void;
  addToPlan: (item: WatchlistItem) => void;
  saveNote: (item: WatchlistItem, notes: string) => void;
  rescore: (item: WatchlistItem) => void;
  edit: (item: WatchlistItem) => void;
  remove: (items: WatchlistItem[]) => void;
};

/** Row «…» menu: move between lists (1/2/3), plan, idea, archive, edit, delete. */
export function RowMenu({
  item, list, canEdit, canModify = canEdit, actions, scoring,
}: {
  item: WatchlistItem; list: ListName | null; canEdit: boolean;
  /** Content edit / delete: the row's author or staff (lib/ownership). Defaults to canEdit. */
  canModify?: boolean;
  actions: RowActions; scoring: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Действия для ${item.ticker}`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel className="text-xs text-muted-foreground">{item.ticker}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => actions.open(item)}>
          <PanelRightOpen className="mr-2 h-4 w-4" />Открыть карточку<DropdownMenuShortcut>Enter</DropdownMenuShortcut>
        </DropdownMenuItem>
        {canEdit && (
          <>
            <DropdownMenuSeparator />
            {list ? (
              LISTS.map((l, i) => (
                <DropdownMenuItem key={l} disabled={l === list} onSelect={() => actions.moveTo([item], l)}>
                  <CornerDownRight className="mr-2 h-4 w-4" />В «{LIST_LABELS[l]}»<DropdownMenuShortcut>{i + 1}</DropdownMenuShortcut>
                </DropdownMenuItem>
              ))
            ) : (
              LISTS.map((l) => (
                <DropdownMenuItem key={l} onSelect={() => actions.restore(item, l)}>
                  <ArchiveRestore className="mr-2 h-4 w-4" />Вернуть в «{LIST_LABELS[l]}»
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => actions.addToPlan(item)}><ClipboardList className="mr-2 h-4 w-4" />В план дня</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.createIdea(item)}><Lightbulb className="mr-2 h-4 w-4" />Создать идею</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.createIdea(item, true)}><ArrowRightLeft className="mr-2 h-4 w-4" />Идея → сделка</DropdownMenuItem>
            <DropdownMenuSeparator />
            {canModify && (
              <DropdownMenuItem onSelect={() => actions.edit(item)}><Pencil className="mr-2 h-4 w-4" />Катализатор, стоп, цель…</DropdownMenuItem>
            )}
            <DropdownMenuItem disabled={scoring} onSelect={() => actions.rescore(item)}><RefreshCw className="mr-2 h-4 w-4" />Пересчитать score</DropdownMenuItem>
            {list && (
              <DropdownMenuItem onSelect={() => actions.archive([item])}>
                <Archive className="mr-2 h-4 w-4" />В архив<DropdownMenuShortcut>Del</DropdownMenuShortcut>
              </DropdownMenuItem>
            )}
            {canModify && (
              <DropdownMenuItem onSelect={() => actions.remove([item])} className="text-down focus:text-down"><Trash2 className="mr-2 h-4 w-4" />Удалить</DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
