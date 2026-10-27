/**
 * The compact top of /themes: the shared compact `PageHeader` (title, one-line description, the live status as its
 * meta line) with «Вид», «+ Доска» and an overflow menu («Настроить темы» for admins; for a personal board: edit, move ← / →, delete) — and the tab strip
 * right under it («Общие темы» first, then the user's boards; scrolls sideways on a phone).
 */
import { useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, MoreHorizontal, Pencil, Plus, Settings2, Shapes, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PageHeader, SectionTabs } from "@/components/ds";
import { commonI18n } from "@/i18n/ns/common";
import { themesI18n } from "@/i18n/ns/themes";
import { MAX_BOARDS, tabOf, tabValue, type BoardMeta, type BoardTab } from "./model";

export function WorkspaceHeader({
  status, view, canEdit, admin, boards, board, onNewBoard, onEditBoard, onMove, onDelete, onConfig,
}: {
  status: ReactNode;
  view: ReactNode;
  canEdit: boolean;
  admin: boolean;
  boards: readonly BoardMeta[];
  board: BoardMeta | null;
  onNewBoard: () => void;
  onEditBoard: () => void;
  onMove: (dir: "left" | "right") => void;
  onDelete: () => void;
  onConfig: () => void;
}) {
  const { t } = themesI18n.useT();
  const [confirm, setConfirm] = useState(false);
  const full = boards.length >= MAX_BOARDS;
  const i = board ? boards.findIndex((b) => b.id === board.id) : -1;
  return (
    <>
      <PageHeader
        size="compact"
        icon={Shapes}
        title={t("title")}
        description={t("description")}
        meta={status ?? undefined}
        actions={
          <div className="flex shrink-0 items-center gap-1">
            {view}
            {canEdit && (
              <Button type="button" variant="ghost" size="sm" className="h-8" disabled={full} title={full ? t("boards.limit", { max: MAX_BOARDS }) : t("boards.newTitle")} onClick={onNewBoard}>
                <Plus aria-hidden="true" /> {t("boards.add")}
              </Button>
            )}
            {(admin || (canEdit && board)) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={t("boards.more")}><MoreHorizontal aria-hidden="true" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {canEdit && board && (
                    <>
                      <DropdownMenuItem onSelect={onEditBoard}><Pencil className="mr-2 h-4 w-4" aria-hidden="true" />{t("boards.edit")}</DropdownMenuItem>
                      <DropdownMenuItem disabled={i <= 0} onSelect={() => onMove("left")}><ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />{t("boards.moveLeft")}</DropdownMenuItem>
                      <DropdownMenuItem disabled={i < 0 || i >= boards.length - 1} onSelect={() => onMove("right")}><ArrowRight className="mr-2 h-4 w-4" aria-hidden="true" />{t("boards.moveRight")}</DropdownMenuItem>
                      <DropdownMenuItem className="text-down" onSelect={() => setConfirm(true)}><Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />{t("boards.remove")}</DropdownMenuItem>
                    </>
                  )}
                  {admin && canEdit && board && <DropdownMenuSeparator />}
                  {admin && <DropdownMenuItem onSelect={onConfig}><Settings2 className="mr-2 h-4 w-4" aria-hidden="true" />{t("config.open")}</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        }
      />
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("boards.removeTitle", { name: board?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("boards.removeDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{commonI18n.t("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete}>{t("boards.remove")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function BoardTabs({ boards, tab, onChange }: { boards: readonly BoardMeta[]; tab: BoardTab; onChange: (tab: BoardTab) => void }) {
  const { t } = themesI18n.useT();
  if (!boards.length) return null;
  return (
    <SectionTabs
      ariaLabel={t("boards.tabsAria")}
      value={tabValue(tab)}
      onChange={(v) => onChange(tabOf(v))}
      tabs={[{ value: "shared", label: t("boards.shared") }, ...boards.map((b) => ({ value: tabValue(b.id), label: b.name }))]}
    />
  );
}
