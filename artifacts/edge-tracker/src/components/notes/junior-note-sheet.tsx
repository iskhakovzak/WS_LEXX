import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { CalendarRange, Loader2, PencilLine, Send, Sparkles, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Pill } from "@/components/ds";
import { useToast } from "@/hooks/use-toast";
import { api, fmtDayLong, qk, relTime, sectionsOf, wordCount, type JuniorNote } from "./junior-lib";
import { FeedbackCard, MarkdownText, MoodPill, ScorePicker, SectionsView } from "./junior-ui";
import { JuniorDayContext } from "./junior-day-context";

/**
 * Side sheet with a full note.
 * - owner: read + "open in editor" + delete
 * - reader: read only
 * - curator: read + feedback/score form
 */
export function JuniorNoteSheet({
  note,
  open,
  onOpenChange,
  mode,
  q,
  onOpenInEditor,
  onReviewed,
  submitLabel,
  queueInfo,
}: {
  note: JuniorNote | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: "owner" | "reader" | "curator";
  q?: string;
  onOpenInEditor?: (date: string) => void;
  /** Called after a successful curator review (e.g. to advance the review queue). */
  onReviewed?: (note: JuniorNote) => void;
  /** Label for the submit button, e.g. "Отправить и дальше" in queue mode. */
  submitLabel?: string;
  /** Position in the review queue, e.g. "2 из 7". */
  queueInfo?: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [feedback, setFeedback] = React.useState("");
  const [score, setScore] = React.useState<number | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [current, setCurrent] = React.useState<JuniorNote | null>(note);

  React.useEffect(() => {
    setCurrent(note);
    setFeedback(note?.curator_feedback ?? "");
    setScore(note?.curator_score ?? null);
    setConfirmDelete(false);
  }, [note]);

  const n = current;
  const sections = sectionsOf(n);

  // The owner reading an unread curator answer marks it as read.
  React.useEffect(() => {
    if (!open || mode !== "owner" || !note || !note.reviewed_at || note.feedback_seen_at) return;
    api<JuniorNote>(`/junior-notes/${note.id}/seen`, { method: "POST", json: {} })
      .then((u) => {
        qc.setQueryData<JuniorNote[]>(qk.history(u.trader), (prev) => prev?.map((x) => (x.id === u.id ? u : x)));
        qc.setQueryData(qk.day(u.trader, u.note_date), u);
      })
      .catch(() => { /* stays unread */ });
  }, [open, mode, note, qc]);

  const syncCaches = (updated: JuniorNote) => {
    qc.setQueryData<JuniorNote[]>(qk.team(updated.note_date), (prev) => prev?.map((x) => (x.id === updated.id ? updated : x)));
    qc.setQueryData<JuniorNote[]>(qk.history(updated.trader), (prev) => prev?.map((x) => (x.id === updated.id ? updated : x)));
    qc.setQueryData(qk.day(updated.trader, updated.note_date), updated);
    qc.setQueryData<JuniorNote[]>(qk.queue, (prev) =>
      prev && (updated.reviewed_at ? prev.filter((x) => x.id !== updated.id) : prev));
    void qc.invalidateQueries({ queryKey: qk.overview(updated.note_date) });
  };

  const saveReview = async () => {
    if (!n) return;
    setSaving(true);
    try {
      const updated = await api<JuniorNote>(`/junior-notes/${n.id}/review`, {
        method: "POST",
        json: { feedback, score },
      });
      setCurrent(updated);
      syncCaches(updated);
      toast({ title: updated.reviewed_at ? `Ответ отправлен ${n.trader}` : "Оценка снята" });
      if (updated.reviewed_at) onReviewed?.(updated);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Не удалось сохранить", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!n) return;
    setDeleting(true);
    try {
      await api(`/junior-notes/${n.id}`, { method: "DELETE" });
      qc.setQueryData<JuniorNote[]>(qk.history(n.trader), (prev) => prev?.filter((x) => x.id !== n.id));
      qc.setQueryData(qk.day(n.trader, n.note_date), null);
      toast({ title: "Сводка удалена" });
      onOpenChange(false);
    } catch {
      toast({ title: "Ошибка удаления", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const onFeedbackKey = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void saveReview(); }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
        {n && (
          <>
            <SheetHeader className="space-y-2 border-b border-border p-5 pr-12 text-left">
              <SheetTitle className="text-lg first-letter:uppercase">
                {mode === "owner" ? fmtDayLong(n.note_date) : `${n.trader} · ${fmtDayLong(n.note_date)}`}
              </SheetTitle>
              <SheetDescription asChild>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <MoodPill mood={n.mood} />
                  <Pill tone="neutral">{wordCount(sections)} слов</Pill>
                  <span>обновлено {relTime(n.updated_at)}</span>
                  {queueInfo && <Pill tone="accent">Очередь · {queueInfo}</Pill>}
                </div>
              </SheetDescription>
              <div className="flex flex-wrap gap-2 pt-1">
                {mode === "owner" && onOpenInEditor && (
                  <Button size="sm" variant="outline" onClick={() => { onOpenChange(false); onOpenInEditor(n.note_date); }}>
                    <PencilLine aria-hidden="true" />Открыть в редакторе
                  </Button>
                )}
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/game-plan?date=${n.note_date}`}><CalendarRange aria-hidden="true" />План дня</Link>
                </Button>
              </div>
            </SheetHeader>

            <div className="flex-1 space-y-5 p-5">
              {mode !== "curator" && <FeedbackCard note={n} />}

              <SectionsView sections={sections} q={q} />

              {n.refined_text && (
                <details className="rounded-xl bg-primary/10 px-4 py-3">
                  <summary className="flex cursor-pointer items-center gap-1.5 text-sm text-primary">
                    <Sparkles className="h-4 w-4" aria-hidden="true" />AI-версия
                  </summary>
                  <div className="mt-3"><MarkdownText text={n.refined_text} /></div>
                </details>
              )}

              {mode === "curator" && (
                <>
                  <JuniorDayContext trader={n.trader} date={n.note_date} />
                  <section className="glass-panel space-y-3 rounded-2xl p-4" aria-label="Ответ куратора">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">Ответ куратора</h3>
                      {n.reviewed_at && (
                        <span className="text-xs text-muted-foreground">
                          {n.reviewed_by} · {relTime(n.reviewed_at)} · {n.feedback_seen_at ? "прочитано" : "не прочитано"}
                        </span>
                      )}
                    </div>
                    <ScorePicker value={score} onChange={setScore} />
                    <label htmlFor="jn-feedback" className="sr-only">Комментарий для трейдера</label>
                    <Textarea
                      id="jn-feedback"
                      rows={4}
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      onKeyDown={onFeedbackKey}
                      placeholder="Что хорошо, что исправить, фокус на завтра. Конкретно и по сделкам."
                      className="[field-sizing:content] min-h-[96px]"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">Ctrl+Enter — отправить</span>
                      <Button onClick={() => void saveReview()} disabled={saving}>
                        {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
                        {submitLabel ?? (n.reviewed_at ? "Обновить ответ" : "Отправить ответ")}
                      </Button>
                    </div>
                  </section>
                </>
              )}
            </div>

            {mode === "owner" && (
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border p-4">
                {confirmDelete ? (
                  <>
                    <span role="alert" className="mr-auto text-sm text-down">Удалить сводку навсегда?</span>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Отмена</Button>
                    <Button size="sm" variant="destructive" disabled={deleting} onClick={() => void doDelete()}>
                      {deleting ? "Удаляю…" : "Да, удалить"}
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-down" onClick={() => setConfirmDelete(true)}>
                    <Trash2 aria-hidden="true" />Удалить
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
