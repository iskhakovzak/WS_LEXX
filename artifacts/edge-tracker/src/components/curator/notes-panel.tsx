import * as React from "react";
import { Lock, NotebookPen, Pin, PinOff, Trash2 } from "lucide-react";
import { EmptyState, Panel, Pill, Segmented } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { curatorApi, useCuratorMutation, type CuratorNote, type NoteKind } from "./api";
import { NOTE_KIND_LABEL, NOTE_KIND_TONE, dateTime } from "./curator-math";

const KIND_OPTIONS = (Object.keys(NOTE_KIND_LABEL) as NoteKind[]).map((k) => ({ value: k, label: NOTE_KIND_LABEL[k] }));

/** Private staff notes about a trader (the trader never sees them). Soft delete only. */
export function NotesPanel({ trader, notes, compact = false }: { trader: string; notes: CuratorNote[]; compact?: boolean }) {
  const { user } = useAuth();
  const me = user?.traderName ?? null;
  const { toast } = useToast();
  const [body, setBody] = React.useState("");
  const [kind, setKind] = React.useState<NoteKind>("note");
  const [filter, setFilter] = React.useState<NoteKind | "all">("all");
  const add = useCuratorMutation((v: { body: string; kind: NoteKind }) => curatorApi.addNote({ trader, ...v }));
  const patch = useCuratorMutation((v: { id: number; pinned: boolean }) => curatorApi.patchNote(v.id, { pinned: v.pinned }));
  const archive = useCuratorMutation((id: number) => curatorApi.archiveNote(id));

  const submit = () => {
    const text = body.trim();
    if (!text || add.isPending) return;
    add.mutate({ body: text, kind }, {
      onSuccess: () => { setBody(""); setKind("note"); toast({ title: "Заметка сохранена" }); },
      onError: (e) => toast({ title: "Не удалось сохранить", description: (e as Error).message, variant: "destructive" }),
    });
  };

  const shown = filter === "all" ? notes : notes.filter((n) => n.kind === filter);

  return (
    <Panel
      title="Заметки куратора"
      icon={NotebookPen}
      description={<span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" aria-hidden="true" />Видны только кураторам и админам</span>}
      actions={!compact && notes.length > 0 ? (
        <Segmented
          size="sm"
          ariaLabel="Тип заметок"
          value={filter}
          onChange={setFilter}
          options={[{ value: "all", label: "Все", count: notes.length }, ...KIND_OPTIONS.map((o) => ({ ...o, count: notes.filter((n) => n.kind === o.value).length }))]}
        />
      ) : undefined}
    >
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}
      >
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={`Что важно помнить про ${trader}: договорённости, наблюдения, итоги разговора…`}
          rows={compact ? 2 : 3}
          maxLength={4000}
          aria-label="Новая заметка"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented size="sm" ariaLabel="Тип заметки" value={kind} onChange={setKind} options={KIND_OPTIONS} />
          <Button type="submit" size="sm" disabled={!body.trim() || add.isPending}>
            {add.isPending ? "Сохраняю…" : "Сохранить"}
          </Button>
        </div>
      </form>

      <div className="mt-4 flex flex-col gap-2">
        {shown.length === 0 ? (
          <EmptyState compact icon={NotebookPen} title="Заметок пока нет" description="Запишите итог разговора или наблюдение — увидят только кураторы." />
        ) : (
          (compact ? shown.slice(0, 3) : shown).map((n) => (
            <article key={n.id} className={cn("tile flex flex-col gap-1.5 p-3", n.pinned && "ring-1 ring-primary/30")}>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Pill tone={NOTE_KIND_TONE[n.kind] ?? "neutral"}>{NOTE_KIND_LABEL[n.kind] ?? n.kind}</Pill>
                <span className="font-medium text-foreground">{n.author}</span>
                <span className="tabular-nums">{dateTime(n.createdAt)}</span>
                {n.pinned && <span className="inline-flex items-center gap-1 text-primary"><Pin className="h-3 w-3" aria-hidden="true" />закреплено</span>}
                {!compact && (
                  <span className="ml-auto flex items-center gap-1">
                    <Button
                      type="button" variant="ghost" size="sm" className="h-7 px-2"
                      aria-label={n.pinned ? "Открепить" : "Закрепить"}
                      title={n.pinned ? "Открепить" : "Закрепить"}
                      disabled={patch.isPending}
                      onClick={() => patch.mutate({ id: n.id, pinned: !n.pinned })}
                    >
                      {n.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                    </Button>
                    {n.author === me && (
                      <Button
                        type="button" variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-down"
                        aria-label="Убрать в архив" title="Убрать в архив"
                        disabled={archive.isPending}
                        onClick={() => archive.mutate(n.id, { onSuccess: () => toast({ title: "Заметка в архиве" }) })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </span>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm text-foreground">{n.body}</p>
            </article>
          ))
        )}
        {compact && shown.length > 3 && <p className="text-xs text-muted-foreground">И ещё {shown.length - 3} — во вкладке «Заметки».</p>}
      </div>
    </Panel>
  );
}
