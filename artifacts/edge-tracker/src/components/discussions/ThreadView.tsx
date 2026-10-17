import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAddComment, getListDiscussionsQueryKey } from "@workspace/api-client-react";
import type { Comment } from "@workspace/api-client-react";
import {
  ArrowLeft, ArrowBigUp, ArrowBigDown, MoreHorizontal, Pencil, Trash2, Flag, Pin, PinOff, CheckCircle2,
  RotateCcw, Link2, Reply, Send, X, Check, Users, CornerDownRight, Award, Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Pill, Segmented, toneOf, toneText } from "@/components/ds";
import { ScreenshotDisplay } from "@/components/screenshot-fields";
import { useToast } from "@/hooks/use-toast";
import { BASE } from "@/lib/api";
import { cn } from "@/lib/utils";
import { RichText, plainPreview } from "./RichText";
import { TickerLink } from "./TickerContext";
import { EntityCard } from "./EntityCard";
import { audienceText, isRestricted, useAudienceOptions } from "./audience";
import { Avatar } from "./ThreadList";
import type { ReportTarget } from "./ReportDialog";
import {
  type Thread, type VoteMap, type PositionStatus, type ParsedComment, TYPE_LABELS, TYPE_TONE, STATUS_LABELS, STATUS_TONE,
  buildCommentTree, buildCommentText, teamPositions, splitNotes, userTags, isPinned, isResolved, toggleTag,
  TAG_PINNED, TAG_RESOLVED, relTime, absTime,
} from "./lib";

type StatusChoice = PositionStatus | "none";

function VoteControl({ id, votes, disabled, onVote }: { id: number; votes: VoteMap; disabled: boolean; onVote: (id: number, v: 1 | -1) => void }) {
  const v = votes[id];
  const score = v?.score ?? 0;
  return (
    <div className="glass-field inline-flex items-center gap-0.5 p-0.5" role="group" aria-label="Голосование">
      <button type="button" aria-label="Полезно" aria-pressed={v?.myVote === 1} disabled={disabled} onClick={() => onVote(id, 1)}
        className={cn("grid h-8 w-8 place-items-center rounded-full transition-colors disabled:opacity-50", v?.myVote === 1 ? "bg-up/15 text-up" : "text-muted-foreground hover:text-up")}>
        <ArrowBigUp className="h-4 w-4" />
      </button>
      <span className={cn("min-w-6 text-center text-sm font-semibold tabular-nums", toneText(toneOf(score)))} title={`За: ${v?.upvotes ?? 0} · Против: ${v?.downvotes ?? 0}`}>
        {score > 0 ? `+${score}` : score < 0 ? `−${Math.abs(score)}` : 0}
      </span>
      <button type="button" aria-label="Не согласен" aria-pressed={v?.myVote === -1} disabled={disabled} onClick={() => onVote(id, -1)}
        className={cn("grid h-8 w-8 place-items-center rounded-full transition-colors disabled:opacity-50", v?.myVote === -1 ? "bg-down/15 text-down" : "text-muted-foreground hover:text-down")}>
        <ArrowBigDown className="h-4 w-4" />
      </button>
    </div>
  );
}

function CommentItem({
  c, parsed, isNew, me, canEdit, canModerate, knownTickers, q, onTickerFilter, onReply, onReport, onDelete,
  editing, setEditing, onSaveEdit, savingEdit, replyToAuthor, compact, accepted, canAccept, onAccept,
}: {
  c: Comment; parsed: ParsedComment; isNew: boolean; me: string; canEdit: boolean; canModerate: boolean;
  knownTickers: Set<string>; q: string; onTickerFilter: (t: string) => void;
  onReply: (c: Comment) => void; onReport: (t: ReportTarget) => void; onDelete: (c: Comment) => void;
  editing: { id: number; text: string } | null; setEditing: (e: { id: number; text: string } | null) => void;
  onSaveEdit: () => void; savingEdit: boolean; replyToAuthor?: string | null; compact?: boolean;
  accepted?: boolean; canAccept?: boolean; onAccept?: (c: Comment) => void;
}) {
  const isOwn = !!c.trader && c.trader === me;
  const isEditing = editing?.id === c.id;
  const pending = c.id < 0;
  return (
    <div id={`comment-${c.id}`} className={cn("group flex gap-3 rounded-xl px-2 py-2 transition-colors", isNew && "bg-primary/[0.06]", accepted && "ring-1 ring-up/40 bg-up/[0.05]", pending && "opacity-60")}>
      <Avatar name={c.trader} size={compact ? "sm" : "md"} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-foreground">{c.trader ?? "Гость"}</span>
          {parsed.status && <Pill tone={STATUS_TONE[parsed.status]} dot className="py-0 text-2xs">{STATUS_LABELS[parsed.status]}</Pill>}
          {replyToAuthor && <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"><CornerDownRight className="h-3 w-3" aria-hidden="true" />{replyToAuthor}</span>}
          <span className="text-xs text-muted-foreground tabular-nums" title={absTime(c.createdAt)}>{pending ? "отправка…" : relTime(c.createdAt)}</span>
          {isNew && <Pill tone="accent" className="py-0 text-2xs">новое</Pill>}
          {accepted && <Pill tone="up" className="py-0 text-2xs"><Award className="h-3 w-3" aria-hidden="true" />Принятый ответ</Pill>}
          {!isEditing && !pending && canEdit && (
            <div className="ml-auto flex items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
              {canAccept && onAccept && (
                <button type="button" aria-label={accepted ? "Снять отметку «принятый ответ»" : "Отметить как принятый ответ"} title={accepted ? "Снять отметку" : "Принятый ответ"} onClick={() => onAccept(c)} className={cn("grid h-8 w-8 place-items-center rounded-full hover:bg-[var(--glass-hover-bg)]", accepted ? "text-up" : "text-muted-foreground hover:text-up")}><Award className="h-3.5 w-3.5" /></button>
              )}
              <button type="button" aria-label="Ответить" title="Ответить" onClick={() => onReply(c)} className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground"><Reply className="h-3.5 w-3.5" /></button>
              {isOwn && (
                <button type="button" aria-label="Редактировать комментарий" title="Редактировать" onClick={() => setEditing({ id: c.id, text: parsed.body })} className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
              )}
              {(isOwn || canModerate) && (
                <button type="button" aria-label="Удалить комментарий" title="Удалить" onClick={() => onDelete(c)} className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-down/15 hover:text-down"><Trash2 className="h-3.5 w-3.5" /></button>
              )}
              {!isOwn && (
                <button type="button" aria-label="Пожаловаться на комментарий" title="Пожаловаться" onClick={() => onReport({ type: "comment", id: c.id, preview: plainPreview(parsed.body, 120), author: c.trader })} className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-down"><Flag className="h-3.5 w-3.5" /></button>
              )}
            </div>
          )}
        </div>
        {isEditing ? (
          <div className="mt-1.5 space-y-2">
            <Textarea aria-label="Текст комментария" autoFocus rows={3} value={editing!.text}
              onChange={(e) => setEditing({ id: c.id, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSaveEdit(); }
                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEditing(null); }
              }} />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}><X className="h-3.5 w-3.5" />Отмена</Button>
              <Button size="sm" variant="outline" onClick={onSaveEdit} disabled={savingEdit || !editing!.text.trim()}><Check className="h-3.5 w-3.5" />{savingEdit ? "Сохраняем…" : "Сохранить"}</Button>
            </div>
          </div>
        ) : (
          <RichText text={parsed.body} className="mt-0.5" knownTickers={knownTickers} me={me} highlight={q} onTickerFilter={onTickerFilter} />
        )}
      </div>
    </div>
  );
}

export function ThreadView({
  thread, me, canEdit, isMod, votes, onVote, knownTickers, traderNames, q, seenAt, onBack, onEdit, onDelete,
  onReport, onTickerFilter, composerRef,
}: {
  thread: Thread;
  me: string;
  canEdit: boolean;
  isMod: boolean;
  votes: VoteMap;
  onVote: (id: number, v: 1 | -1) => void;
  knownTickers: Set<string>;
  traderNames: string[];
  q: string;
  seenAt: string;
  onBack: () => void;
  onEdit: (t: Thread) => void;
  onDelete: (t: Thread) => void;
  onReport: (t: ReportTarget) => void;
  onTickerFilter: (t: string) => void;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = React.useState("");
  const [status, setStatus] = React.useState<StatusChoice>(() => {
    try { return (localStorage.getItem("ws_lexx_disc_status") as StatusChoice) || "observing"; } catch { return "observing"; }
  });
  const [replyTo, setReplyTo] = React.useState<Comment | null>(null);
  const [editing, setEditing] = React.useState<{ id: number; text: string } | null>(null);
  const [savingEdit, setSavingEdit] = React.useState(false);
  const restricted = isRestricted(thread.audience);
  const audienceOpts = useAudienceOptions(restricted);
  const [deletingComment, setDeletingComment] = React.useState<Comment | null>(null);
  const [deletingBusy, setDeletingBusy] = React.useState(false);
  const [flagBusy, setFlagBusy] = React.useState(false);
  const [caret, setCaret] = React.useState(0);

  // Reset per-thread UI when switching threads (keep per-thread drafts in memory).
  const drafts = React.useRef<Record<number, string>>({});
  const prevId = React.useRef(thread.id);
  React.useEffect(() => {
    if (prevId.current !== thread.id) {
      drafts.current[prevId.current] = draft;
      setDraft(drafts.current[thread.id] ?? "");
      setReplyTo(null);
      setEditing(null);
      prevId.current = thread.id;
    }
  }, [thread.id]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    try { localStorage.setItem("ws_lexx_disc_status", status); } catch { /* ignore */ }
  }, [status]);

  const listKey = getListDiscussionsQueryKey();
  const comments = thread.comments ?? [];
  const tree = React.useMemo(() => buildCommentTree(comments), [comments]);
  const positions = React.useMemo(() => teamPositions(comments), [comments]);
  const { text: notesText, images } = splitNotes(thread.notes);
  const tags = userTags(thread.tags);
  const isAuthor = !!thread.trader && thread.trader === me;
  const canManage = canEdit && (isAuthor || isMod);
  const seenMs = new Date(seenAt).getTime();
  const pinned = isPinned(thread);
  const resolved = isResolved(thread);

  const addMut = useAddComment({
    mutation: {
      onMutate: async (vars) => {
        await qc.cancelQueries({ queryKey: listKey });
        const prev = qc.getQueryData<Thread[]>(listKey);
        const temp: Comment = { id: -Date.now(), discussionId: vars.id, trader: me, text: vars.data.text, createdAt: new Date().toISOString() };
        qc.setQueryData<Thread[]>(listKey, (old) => old?.map((d) => d.id === vars.id
          ? { ...d, comments: [...(d.comments ?? []), temp], commentCount: (d.comments?.length ?? 0) + 1, lastActivityAt: temp.createdAt, lastActivityBy: me }
          : d));
        return { prev };
      },
      onError: (e: unknown, vars, ctx) => {
        if (ctx?.prev) qc.setQueryData(listKey, ctx.prev);
        setDraft((d) => d || parseBody(vars.data.text));
        toast({ title: "Ошибка", description: (e as { data?: { error?: string } })?.data?.error ?? String(e), variant: "destructive" });
      },
      onSettled: () => qc.invalidateQueries({ queryKey: listKey }),
    },
  });

  function parseBody(text: string) {
    return text.replace(/^(\[[^\]]+\]\s*)?(\[re:\d+\]\s*)?/, "");
  }

  function send() {
    const body = draft.trim();
    if (!body || addMut.isPending) return;
    const text = buildCommentText(body, status === "none" ? null : status, replyTo?.id && replyTo.id > 0 ? replyTo.id : null);
    addMut.mutate({ id: thread.id, data: { text } }); // author = signed-in user (server-side)
    setDraft("");
    setReplyTo(null);
    drafts.current[thread.id] = "";
  }

  async function saveEdit() {
    if (!editing || savingEdit) return;
    const orig = comments.find((c) => c.id === editing.id);
    if (!orig) return;
    const body = editing.text.trim();
    if (!body) { toast({ title: "Комментарий не может быть пустым", variant: "destructive" }); return; }
    const prefix = orig.text.match(/^(\[(?:Observing|In Position|Exited|Наблюдаю|В позиции|Вышел)\]\s*)?(\[re:\d+\]\s*)?/)?.[0] ?? "";
    setSavingEdit(true);
    try {
      const r = await fetch(`${BASE}/api/discussions/${thread.id}/comments/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `${prefix}${body}` }),
      });
      const resBody = await r.json().catch(() => null);
      if (!r.ok) throw new Error(resBody?.error ?? "Не удалось сохранить комментарий");
      qc.invalidateQueries({ queryKey: listKey });
      setEditing(null);
      toast({ title: "Комментарий обновлён" });
    } catch (e) {
      toast({ title: "Ошибка", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSavingEdit(false);
    }
  }

  async function confirmDeleteComment() {
    if (!deletingComment || deletingBusy) return;
    setDeletingBusy(true);
    try {
      const r = await fetch(`${BASE}/api/discussions/${thread.id}/comments/${deletingComment.id}`, { method: "DELETE" });
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        throw new Error(body?.error ?? "Не удалось удалить комментарий");
      }
      qc.invalidateQueries({ queryKey: listKey });
      setDeletingComment(null);
      toast({ title: "Комментарий удалён" });
    } catch (e) {
      toast({ title: "Ошибка", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setDeletingBusy(false);
    }
  }

  async function setFlag(tag: string, on: boolean) {
    if (flagBusy) return;
    setFlagBusy(true);
    const nextTags = toggleTag(thread.tags, tag, on);
    const prev = qc.getQueryData<Thread[]>(listKey);
    qc.setQueryData<Thread[]>(listKey, (old) => old?.map((d) => d.id === thread.id
      ? { ...d, tags: nextTags, ...(tag === TAG_PINNED ? { pinned: on } : { resolved: on }) }
      : d));
    try {
      const r = await fetch(`${BASE}/api/discussions/${thread.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: nextTags }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.error ?? "Не удалось обновить тему");
      toast({ title: tag === TAG_PINNED ? (on ? "Тема закреплена" : "Тема откреплена") : (on ? "Отмечено как решённое" : "Тема снова открыта") });
    } catch (e) {
      if (prev) qc.setQueryData(listKey, prev);
      toast({ title: "Ошибка", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setFlagBusy(false);
      qc.invalidateQueries({ queryKey: listKey });
    }
  }

  const [acceptBusy, setAcceptBusy] = React.useState(false);
  async function acceptAnswer(c: Comment) {
    if (acceptBusy) return;
    const next = thread.acceptedCommentId === c.id ? null : c.id;
    setAcceptBusy(true);
    try {
      const r = await fetch(`${BASE}/api/discussions/${thread.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acceptedCommentId: next }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.error ?? "Не удалось обновить тему");
      toast({ title: next ? "Ответ отмечен как принятый — тема решена" : "Отметка снята" });
    } catch (e) {
      toast({ title: "Ошибка", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setAcceptBusy(false);
      qc.invalidateQueries({ queryKey: listKey });
    }
  }

  function copyLink() {
    const url = `${window.location.origin}${window.location.pathname}?thread=${thread.id}`;
    navigator.clipboard?.writeText(url).then(
      () => toast({ title: "Ссылка скопирована" }),
      () => toast({ title: "Не удалось скопировать", description: url }),
    );
  }

  function startReply(c: Comment) {
    setReplyTo(c);
    if (c.trader && c.trader !== me && !draft.includes(`@${c.trader}`)) setDraft((d) => `@${c.trader} ${d}`);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  // @mention autocomplete: the token right before the caret.
  const mentionQuery = React.useMemo(() => {
    const before = draft.slice(0, caret);
    const m = before.match(/(?:^|\s)@([\p{L}\d_]*)$/u);
    return m ? m[1].toLowerCase() : null;
  }, [draft, caret]);
  const mentionOptions = mentionQuery == null ? [] : traderNames.filter((n) => n !== me && n.toLowerCase().startsWith(mentionQuery)).slice(0, 6);

  function insertMention(name: string) {
    const before = draft.slice(0, caret).replace(/@([\p{L}\d_]*)$/u, `@${name} `);
    const after = draft.slice(caret);
    setDraft(before + after);
    requestAnimationFrame(() => {
      const el = composerRef.current;
      if (el) { el.focus(); el.setSelectionRange(before.length, before.length); setCaret(before.length); }
    });
  }

  const posCount = positions.in_position.length + positions.observing.length + positions.exited.length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="border-b border-[var(--field-border)] px-4 pb-3 pt-4 sm:px-5">
        <div className="flex flex-wrap items-start gap-2">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="Назад к списку тем" className="-ml-2 h-9 w-9 shrink-0 lg:hidden">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          {/* min width: on phones the vote/menu cluster wraps below instead of squeezing the topic into a narrow column */}
          <div className="min-w-[min(100%,14rem)] flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {pinned && <Pill tone="accent" className="py-0 text-2xs"><Pin className="h-3 w-3" aria-hidden="true" />Закреплено</Pill>}
              {thread.type && <Pill tone={TYPE_TONE[thread.type] ?? "neutral"} className="py-0 text-2xs">{TYPE_LABELS[thread.type] ?? thread.type}</Pill>}
              {thread.ticker && <TickerLink ticker={thread.ticker} variant="chip" onFilter={onTickerFilter} />}
              {resolved && <Pill tone="up" className="py-0 text-2xs"><CheckCircle2 className="h-3 w-3" aria-hidden="true" />Решено</Pill>}
              {restricted && (
                <Pill tone="purple" className="max-w-full py-0 text-2xs" title="Тему видят только эти группы, автор и кураторы">
                  <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">Видна: {audienceText(thread.audience, audienceOpts.data)}</span>
                </Pill>
              )}
            </div>
            <h2 className="mt-1.5 text-lg font-semibold leading-snug tracking-tight text-foreground sm:text-xl">{thread.topic}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><Avatar name={thread.trader} size="xs" />{thread.trader ?? "Гость"}</span>
              <span title={absTime(thread.createdAt)}>{relTime(thread.createdAt)}</span>
              <span>· {comments.length} {comments.length === 1 ? "ответ" : comments.length >= 2 && comments.length <= 4 ? "ответа" : "ответов"}</span>
            </div>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <VoteControl id={thread.id} votes={votes} disabled={!canEdit} onVote={onVote} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Действия с темой" className="h-9 w-9"><MoreHorizontal className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={copyLink}><Link2 className="mr-2 h-4 w-4" />Скопировать ссылку</DropdownMenuItem>
                {canManage && (
                  <>
                    <DropdownMenuItem onSelect={() => onEdit(thread)}><Pencil className="mr-2 h-4 w-4" />Редактировать</DropdownMenuItem>
                    <DropdownMenuItem disabled={flagBusy} onSelect={() => setFlag(TAG_RESOLVED, !resolved)}>
                      {resolved ? <><RotateCcw className="mr-2 h-4 w-4" />Открыть снова</> : <><CheckCircle2 className="mr-2 h-4 w-4" />Отметить решённой</>}
                    </DropdownMenuItem>
                  </>
                )}
                {canEdit && isMod && (
                  <DropdownMenuItem disabled={flagBusy} onSelect={() => setFlag(TAG_PINNED, !pinned)}>
                    {pinned ? <><PinOff className="mr-2 h-4 w-4" />Открепить</> : <><Pin className="mr-2 h-4 w-4" />Закрепить сверху</>}
                  </DropdownMenuItem>
                )}
                {canEdit && !isAuthor && (
                  <DropdownMenuItem onSelect={() => onReport({ type: "discussion", id: thread.id, preview: thread.topic, author: thread.trader })}>
                    <Flag className="mr-2 h-4 w-4" />Пожаловаться
                  </DropdownMenuItem>
                )}
                {canManage && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => onDelete(thread)} className="text-down focus:text-down"><Trash2 className="mr-2 h-4 w-4" />Удалить тему</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
        <EntityCard thread={thread} />
        {(notesText || images.length > 0 || tags.length > 0) && (
          <div className="space-y-3">
            {notesText && <RichText text={notesText} knownTickers={knownTickers} me={me} highlight={q} onTickerFilter={onTickerFilter} />}
            {images.length > 0 && <ScreenshotDisplay urls={images.join("\n")} />}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">{tags.map((t) => <Pill key={t} tone="neutral" className="text-2xs">#{t}</Pill>)}</div>
            )}
          </div>
        )}

        {posCount > 0 && (
          <div className="rounded-xl bg-[var(--glass-bg)] p-3">
            <div className="mb-2 flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /><span className="micro-label">Позиции команды</span></div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(["in_position", "observing", "exited"] as PositionStatus[]).map((s) => (
                <div key={s} className="min-w-0">
                  <div className="flex items-center justify-between text-xs">
                    <Pill tone={STATUS_TONE[s]} dot className="py-0 text-2xs">{STATUS_LABELS[s]}</Pill>
                    <span className="tabular-nums text-muted-foreground">{positions[s].length}</span>
                  </div>
                  <div className="mt-1 truncate text-xs text-foreground/80" title={positions[s].join(", ")}>{positions[s].join(", ") || "—"}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="micro-label">Обсуждение</span>
          </div>
          {tree.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--field-border)] px-4 py-6 text-center text-sm text-muted-foreground">
              Ответов пока нет. Поделитесь мнением или отметьте, что вы в позиции.
            </p>
          ) : (
            <div className="space-y-1">
              {tree.map((node) => (
                <div key={node.comment.id}>
                  <CommentItem
                    c={node.comment} parsed={node.parsed} isNew={node.comment.trader !== me && new Date(node.comment.createdAt).getTime() > seenMs}
                    me={me} canEdit={canEdit} canModerate={isMod} knownTickers={knownTickers} q={q} onTickerFilter={onTickerFilter}
                    onReply={startReply} onReport={onReport} onDelete={setDeletingComment}
                    editing={editing} setEditing={setEditing} onSaveEdit={saveEdit} savingEdit={savingEdit}
                    accepted={thread.acceptedCommentId === node.comment.id} canAccept={canManage && node.comment.id > 0} onAccept={acceptAnswer}
                  />
                  {node.replies.length > 0 && (
                    <div className="ml-5 space-y-1 border-l border-[var(--field-border)] pl-3 sm:ml-7">
                      {node.replies.map((r) => (
                        <CommentItem key={r.comment.id}
                          c={r.comment} parsed={r.parsed} replyToAuthor={r.replyToAuthor} compact
                          isNew={r.comment.trader !== me && new Date(r.comment.createdAt).getTime() > seenMs}
                          me={me} canEdit={canEdit} canModerate={isMod} knownTickers={knownTickers} q={q} onTickerFilter={onTickerFilter}
                          onReply={startReply} onReport={onReport} onDelete={setDeletingComment}
                          editing={editing} setEditing={setEditing} onSaveEdit={saveEdit} savingEdit={savingEdit}
                          accepted={thread.acceptedCommentId === r.comment.id} canAccept={canManage && r.comment.id > 0} onAccept={acceptAnswer}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      {canEdit && (
        <div className="glass-thick sticky bottom-0 z-sticky rounded-b-2xl bg-[var(--sticky-bg)] border-x-0 border-b-0 px-4 pb-4 pt-3 sm:px-5">
          {replyTo && (
            <div className="mb-2 flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-1.5 text-xs">
              <Reply className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">Ответ <span className="font-semibold">{replyTo.trader ?? "Гость"}</span>: {plainPreview(parseBody(replyTo.text), 80)}</span>
              <button type="button" aria-label="Отменить ответ" onClick={() => setReplyTo(null)} className="grid h-7 w-7 place-items-center rounded-full hover:bg-[var(--glass-hover-bg)]"><X className="h-3.5 w-3.5" /></button>
            </div>
          )}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <Segmented<StatusChoice>
              ariaLabel="Ваш статус по теме"
              size="sm"
              value={status}
              onChange={setStatus}
              options={[
                { value: "none", label: "Без статуса" },
                { value: "observing", label: STATUS_LABELS.observing },
                { value: "in_position", label: STATUS_LABELS.in_position },
                { value: "exited", label: STATUS_LABELS.exited },
              ]}
            />
            <span className="hidden text-2xs text-muted-foreground md:inline">**жирный** · `код` · &gt; цитата · $TICKER · @имя</span>
          </div>
          {mentionOptions.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5" role="listbox" aria-label="Упомянуть участника">
              {mentionOptions.map((n) => (
                <button key={n} type="button" role="option" aria-selected="false" onMouseDown={(e) => e.preventDefault()} onClick={() => insertMention(n)} className="chip inline-flex min-h-7 items-center gap-1.5 px-2.5 text-xs">
                  <Avatar name={n} size="xs" />@{n}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              ref={composerRef}
              aria-label="Новый комментарий"
              value={draft}
              rows={2}
              placeholder={replyTo ? "Ваш ответ…" : "Комментарий… (Ctrl+Enter — отправить)"}
              className="max-h-48 min-h-[44px] flex-1 resize-y"
              onChange={(e) => { setDraft(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); }}
              onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
                if (e.key === "Tab" && mentionOptions.length > 0) { e.preventDefault(); insertMention(mentionOptions[0]); }
                if (e.key === "Escape") {
                  if (replyTo) { e.preventDefault(); e.stopPropagation(); setReplyTo(null); }
                  else (e.target as HTMLTextAreaElement).blur();
                }
              }}
            />
            <Button onClick={send} disabled={!draft.trim() || addMut.isPending} aria-label="Отправить комментарий" className="h-11 shrink-0 gap-1.5">
              <Send className="h-4 w-4" /><span className="hidden sm:inline">Отправить</span>
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={!!deletingComment} onOpenChange={(v) => { if (!v && !deletingBusy) setDeletingComment(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить комментарий?</AlertDialogTitle>
            <AlertDialogDescription>Комментарий будет удалён без возможности восстановления.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingBusy}>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmDeleteComment(); }} disabled={deletingBusy} className="bg-destructive text-destructive-foreground">
              {deletingBusy ? "Удаляем…" : "Удалить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
