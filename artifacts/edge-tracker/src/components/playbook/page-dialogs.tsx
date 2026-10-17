/** Page-level dialogs: rename folder (with explicit merge on 409), delete folder, delete setup, activity sheet. */
import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EmptyState, Pill, type Tone } from "@/components/ds";
import { plural } from "@/components/playbook-sub/bits";
import { ApiError, pbRequest, usePlaybookActivity } from "./api";
import { timeAgo } from "./model";

const destructive = "bg-down text-white hover:bg-down/90";

/** Rename; when the target exists the server answers 409 and we ask before merging. */
export function RenameFolderDialog({
  folder, onClose, trader, onRenamed, space,
}: {
  folder: string | null;
  onClose: () => void;
  trader: string;
  /** "personal" renames the caller's own folder in «Мой» (office folders: curators). */
  space?: "office" | "personal";
  onRenamed: (from: string, to: string, merged: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ to: string; count: number } | null>(null);
  useEffect(() => { if (folder != null) { setValue(folder); setError(null); setConflict(null); } }, [folder]);

  async function submit(merge = false) {
    if (folder == null) return;
    const to = value.trim();
    if (!to || to === folder) { onClose(); return; }
    setPending(true);
    setError(null);
    try {
      const r = await pbRequest<{ merged?: boolean }>("/api/playbook/rename-folder", { method: "PATCH", json: { from: folder, to, trader, merge, ...(space ? { space } : {}) } });
      onRenamed(folder, to, !!r?.merged || merge);
      setConflict(null);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict({ to, count: Number(e.data?.targetCount) || 0 });
      else setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Dialog open={folder != null && !conflict} onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Переименовать папку</DialogTitle>
            <DialogDescription>Все сетапы папки «{folder}» переедут под новое имя.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); submit(false); }} className="space-y-2">
            <Label htmlFor="pb-rename-folder" className="text-xs text-muted-foreground">Новое название</Label>
            <Input id="pb-rename-folder" value={value} onChange={(e) => setValue(e.target.value)} maxLength={120} autoFocus />
            {error && <p className="text-xs text-down" role="alert">{error}</p>}
            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={onClose}>Отмена</Button>
              <Button type="submit" disabled={pending || !value.trim()}>{pending ? "Сохраняем…" : "Переименовать"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!conflict} onOpenChange={(v) => { if (!v) setConflict(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Папка «{conflict?.to}» уже существует</AlertDialogTitle>
            <AlertDialogDescription>
              В ней {conflict?.count ?? 0} {plural(conflict?.count ?? 0, "сетап", "сетапа", "сетапов")}. Объединить «{folder}» с ней? Отменить объединение потом можно только вручную.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Выбрать другое имя</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); submit(true); }} disabled={pending}>
              {pending ? "Объединяем…" : "Объединить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function DeleteFolderDialog({
  folder, count, onClose, onConfirm, pending,
}: {
  folder: string | null; count: number; onClose: () => void; onConfirm: (password: string) => void; pending: boolean;
}) {
  const [pwd, setPwd] = useState("");
  useEffect(() => { if (folder == null) setPwd(""); }, [folder]);
  return (
    <AlertDialog open={folder != null} onOpenChange={(v) => { if (!v) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить папку «{folder}»?</AlertDialogTitle>
          <AlertDialogDescription>
            Вместе с ней будут удалены {count} {plural(count, "сетап", "сетапа", "сетапов")}. Для подтверждения введите пароль плейбука.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form id="pb-del-folder" onSubmit={(e) => { e.preventDefault(); if (pwd && !pending) onConfirm(pwd); }}>
          <Label htmlFor="pb-del-folder-pwd" className="sr-only">Пароль</Label>
          <Input id="pb-del-folder-pwd" type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="Пароль" autoFocus autoComplete="off" />
        </form>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); if (pwd && !pending) onConfirm(pwd); }}
            disabled={!pwd || pending}
            className={destructive}
          >
            {pending ? "Удаляем…" : "Удалить папку"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DeleteSetupDialog({
  name, open, onClose, onConfirm, pending,
}: {
  name: string | null; open: boolean; onClose: () => void; onConfirm: () => void; pending: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить «{name}»?</AlertDialogTitle>
          <AlertDialogDescription>Удаление можно отменить сразу после него. Варианты (дочерние сетапы) останутся в плейбуке.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction onClick={(e) => { e.preventDefault(); if (!pending) onConfirm(); }} disabled={pending} className={destructive}>
            {pending ? "Удаляем…" : "Удалить"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const ACTION_LABELS: Record<string, { label: string; tone: Tone }> = {
  created: { label: "Создан", tone: "up" },
  updated: { label: "Изменён", tone: "accent" },
  deleted: { label: "Удалён", tone: "down" },
  restored: { label: "Восстановлен", tone: "up" },
  renamed: { label: "Переименован", tone: "purple" },
};

export function ActivitySheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data = [], isLoading, isError, refetch } = usePlaybookActivity(open);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Журнал плейбука</SheetTitle>
          <SheetDescription>Последние изменения сетапов и папок</SheetDescription>
        </SheetHeader>
        <div className="-mx-2 mt-2 min-h-0 flex-1 overflow-y-auto">
          {isLoading && <div className="space-y-2 px-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>}
          {isError && (
            <p className="px-2 py-4 text-sm text-down">
              Не удалось загрузить журнал. <button type="button" className="underline" onClick={() => refetch()}>Повторить</button>
            </p>
          )}
          {!isLoading && !isError && data.length === 0 && <EmptyState icon={Activity} title="Пока пусто" description="Здесь появятся создания, правки и удаления сетапов." />}
          <ul className="space-y-1">
            {data.map((a) => {
              const meta = ACTION_LABELS[a.action] ?? { label: a.action, tone: "neutral" as Tone };
              return (
                <li key={a.id} className="rounded-xl px-2 py-2 hover:bg-[var(--glass-hover-bg)]">
                  <div className="flex items-center gap-2">
                    <Pill tone={meta.tone}>{meta.label}</Pill>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.entityTitle ?? "—"}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                    {a.trader && <span>{a.trader}</span>}
                    <span>{timeAgo(a.createdAt)}</span>
                    {a.details && <span className="min-w-0 truncate">· {a.details}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
}
