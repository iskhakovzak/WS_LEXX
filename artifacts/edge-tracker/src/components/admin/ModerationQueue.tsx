import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Ban, Check, ExternalLink, Flag, MessageCircle, MessagesSquare, MoreHorizontal, ShieldCheck, Trash2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { QueryError } from "@/components/query-error";
import { EmptyState, Kbd, Panel, Pill, Segmented } from "@/components/ds";
import { cn } from "@/lib/utils";
import { BASE } from "@/lib/api";
import { ReasonDialog, type ReasonDialogState } from "./ReasonDialog";
import { BAN_PRESETS } from "./useUserActions";
import { ROLE_LABEL, adminUrl, errorFrom, isTypingTarget, postJson, timeAgo, useReports, type ContentReport } from "./api";

type Status = "open" | "resolved" | "dismissed" | "all";

const STATUS_LABEL: Record<string, string> = { open: "Открыта", resolved: "Решена", dismissed: "Отклонена" };
const RESOLVE_PRESETS = ["Контент удалён", "Предупреждение автору", "Исправлено автором"];
const DISMISS_PRESETS = ["Не нарушает правила", "Дубликат жалобы", "Недостаточно контекста"];

const EASE = [0.2, 0.8, 0.2, 1] as const;

export function ModerationQueue({ actor, openCount }: { actor: string; openCount?: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const reduce = useReducedMotion();
  const [status, setStatus] = useState<Status>("open");
  const [dialog, setDialog] = useState<ReasonDialogState>(null);
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const apiStatus = status === "all" ? "" : status;
  const { data: reports = [], isLoading, isError, error, refetch } = useReports(actor, apiStatus);

  const invalidate = () => {
    for (const k of ["admin-reports", "admin-overview", "admin-audit", "admin-desk-pulse", "admin-users"]) qc.invalidateQueries({ queryKey: [k] });
  };
  const onError = (e: Error) => { toast({ title: "Ошибка", description: e.message, variant: "destructive" }); invalidate(); };

  /** Optimistically drop a report from the open queue. */
  const dropOptimistic = (ids: number[]) => {
    if (status !== "open") return;
    qc.setQueryData<ContentReport[]>(["admin-reports", actor, apiStatus], (old) => old?.filter((r) => !ids.includes(r.id)));
  };

  const resolveMut = useMutation({
    mutationFn: ({ id, kind, resolution }: { id: number; kind: "resolve" | "dismiss"; resolution: string }) =>
      postJson(adminUrl(`/admin/reports/${id}/${kind}`, actor), { actor, resolution }, "Не удалось обработать жалобу"),
    onMutate: ({ id }) => { setDialog(null); dropOptimistic([id]); },
    onSuccess: (_d, v) => { invalidate(); toast({ title: v.kind === "resolve" ? "Жалоба решена" : "Жалоба отклонена", description: v.resolution }); },
    onError,
  });

  const [checked, setChecked] = useState<Set<number>>(new Set());
  useEffect(() => { setChecked(new Set()); }, [status]);
  const toggleChecked = (id: number) => setChecked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const bulkMut = useMutation({
    mutationFn: ({ ids, kind, resolution }: { ids: number[]; kind: "resolve" | "dismiss"; resolution: string }) =>
      postJson<{ updated: number[]; skipped: number[] }>(adminUrl("/admin/reports/bulk", actor), { actor, ids, kind, resolution }, "Не удалось обработать жалобы"),
    onMutate: ({ ids }) => { setDialog(null); dropOptimistic(ids); setChecked(new Set()); },
    onSuccess: (d, v) => {
      invalidate();
      toast({
        title: `${v.kind === "resolve" ? "Решено" : "Отклонено"}: ${d.updated.length}`,
        description: d.skipped.length ? `Пропущено (уже закрыты): ${d.skipped.length}` : v.resolution,
      });
    },
    onError,
  });
  const openIds = reports.filter((r) => r.status === "open").map((r) => r.id);
  const bulk = (kind: "resolve" | "dismiss") => {
    const ids = [...checked];
    setDialog({
      title: `${kind === "resolve" ? "Решить" : "Отклонить"} ${ids.length} ${ids.length === 1 ? "жалобу" : "жалоб(ы)"}`,
      description: "Одна причина для всех выбранных. Каждая жалоба отдельно попадёт в аудит.",
      confirmLabel: kind === "resolve" ? "Решить все" : "Отклонить все",
      input: { label: kind === "resolve" ? "Резолюция" : "Причина отклонения", required: true, presets: kind === "resolve" ? RESOLVE_PRESETS : DISMISS_PRESETS },
      onConfirm: (resolution) => bulkMut.mutate({ ids, kind, resolution }),
    });
  };

  const banAuthorMut = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string; author: string }) =>
      postJson<{ closedReports: number[] }>(adminUrl(`/admin/reports/${id}/ban-author`, actor), { actor, reason, resolveSiblings: true }, "Не удалось забанить автора"),
    onMutate: ({ id }) => { setDialog(null); dropOptimistic([id]); },
    onSuccess: (d, v) => {
      invalidate();
      toast({ title: `${v.author} забанен`, description: `Закрыто жалоб: ${d.closedReports?.length ?? 1}` });
    },
    onError,
  });

  const deleteMut = useMutation({
    mutationFn: async ({ report, reason }: { report: ContentReport; reason: string }) => {
      const path = report.targetType === "discussion" ? "discussions" : "comments";
      const r = await fetch(`${BASE}/api/admin/${path}/${encodeURIComponent(report.targetId)}?actor=${encodeURIComponent(actor)}`, { method: "DELETE" });
      if (!r.ok && r.status !== 404) throw await errorFrom(r, "Не удалось удалить контент");
      await postJson(adminUrl(`/admin/reports/${report.id}/resolve`, actor), { actor, resolution: `Контент удалён: ${reason}` }, "Контент удалён, но жалобу закрыть не удалось");
    },
    onMutate: ({ report }) => { setDialog(null); dropOptimistic([report.id]); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/discussions"] }); invalidate(); toast({ title: "Контент удалён, жалоба закрыта" }); },
    onError,
  });

  const busy = resolveMut.isPending || banAuthorMut.isPending || deleteMut.isPending || bulkMut.isPending;

  const act = useMemo(() => ({
    resolve: (r: ContentReport) => setDialog({
      title: `Решить жалобу #${r.id}`,
      description: "Что сделано по жалобе — увидит команда модерации в аудите.",
      confirmLabel: "Отметить решённой",
      input: { label: "Резолюция", required: true, presets: RESOLVE_PRESETS, placeholder: "Что сделали" },
      onConfirm: (resolution) => resolveMut.mutate({ id: r.id, kind: "resolve", resolution }),
    }),
    dismiss: (r: ContentReport) => setDialog({
      title: `Отклонить жалобу #${r.id}?`,
      confirmLabel: "Отклонить",
      input: { label: "Причина отклонения", required: true, presets: DISMISS_PRESETS },
      onConfirm: (resolution) => resolveMut.mutate({ id: r.id, kind: "dismiss", resolution }),
    }),
    ban: (r: ContentReport) => {
      const author = r.target?.author;
      if (!author) { toast({ title: "Автор не найден", description: "Забаньте вручную во вкладке «Трейдеры».", variant: "destructive" }); return; }
      setDialog({
        title: `Забанить автора — ${author}?`,
        description: `${author} будет разлогинен, жалоба${(r.openReportsOnTarget ?? 1) > 1 ? ` и ещё ${(r.openReportsOnTarget ?? 1) - 1} на этот же контент` : ""} будет закрыта.`,
        confirmLabel: "Забанить и закрыть",
        destructive: true,
        input: { label: "Причина бана", kind: "textarea", required: true, presets: BAN_PRESETS },
        onConfirm: (reason) => banAuthorMut.mutate({ id: r.id, reason, author }),
      });
    },
    remove: (r: ContentReport) => setDialog({
      title: `Удалить ${r.targetType === "discussion" ? "обсуждение" : "комментарий"} и закрыть жалобу?`,
      description: r.targetType === "discussion" ? "Обсуждение будет скрыто для всех." : "Комментарий будет удалён без возможности восстановления.",
      confirmLabel: "Удалить и закрыть",
      destructive: true,
      input: { label: "Причина удаления", required: true, presets: ["Спам", "Оскорбления", "Не по теме", "Слив конфиденциальных данных"] },
      onConfirm: (reason) => deleteMut.mutate({ report: r, reason }),
    }),
  }), [resolveMut, banAuthorMut, deleteMut, toast]);

  // Keyboard triage: J/K move, R resolve, D dismiss, B ban author, X delete content.
  useEffect(() => { setSelected((s) => Math.min(s, Math.max(0, reports.length - 1))); }, [reports.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog || isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector("[role=dialog]")) return;
      const k = e.key.toLowerCase();
      if (k === "j" || (k === "arrowdown" && e.target === document.body)) { setSelected((s) => Math.min(reports.length - 1, s + 1)); e.preventDefault(); return; }
      if (k === "k" || (k === "arrowup" && e.target === document.body)) { setSelected((s) => Math.max(0, s - 1)); e.preventDefault(); return; }
      const r = reports[selected];
      if (!r || r.status !== "open" || busy) return;
      if (k === "s") { e.preventDefault(); toggleChecked(r.id); }
      else if (k === "r") { e.preventDefault(); act.resolve(r); }
      else if (k === "d") { e.preventDefault(); act.dismiss(r); }
      else if (k === "b") { e.preventDefault(); act.ban(r); }
      else if (k === "x") { e.preventDefault(); act.remove(r); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reports, selected, dialog, busy, act]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${selected}"]`)?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [selected, reduce]);

  return (
    <Panel
      title="Очередь модерации"
      description="Жалобы на обсуждения и комментарии. Каждое действие требует причину и пишется в аудит."
      icon={Flag}
      actions={
        <Segmented<Status>
          ariaLabel="Статус жалоб"
          size="sm"
          value={status}
          onChange={(s) => { setStatus(s); setSelected(0); }}
          options={[
            { value: "open", label: "Открытые", count: openCount },
            { value: "resolved", label: "Решённые" },
            { value: "dismissed", label: "Отклонённые" },
            { value: "all", label: "Все" },
          ]}
        />
      }
    >
      <div className="flex flex-col gap-3">
        {status === "open" && reports.length > 0 && (
          <p className="hidden flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground md:flex">
            <span><Kbd>J</Kbd> <Kbd>K</Kbd> навигация</span>
            <span><Kbd>R</Kbd> решить</span>
            <span><Kbd>D</Kbd> отклонить</span>
            <span><Kbd>B</Kbd> бан автора</span>
            <span><Kbd>X</Kbd> удалить контент</span>
            <span><Kbd>S</Kbd> выбрать</span>
          </p>
        )}

        {status === "open" && openIds.length > 1 && (
          <div
            className={cn(
              "flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 transition-colors",
              checked.size ? "bg-primary/10" : "bg-[var(--glass-bg)]",
            )}
            role="toolbar"
            aria-label="Массовые действия"
          >
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[hsl(var(--primary))]"
                checked={checked.size > 0 && openIds.every((id) => checked.has(id))}
                ref={(el) => { if (el) el.indeterminate = checked.size > 0 && !openIds.every((id) => checked.has(id)); }}
                onChange={(e) => setChecked(e.target.checked ? new Set(openIds) : new Set())}
                aria-label="Выбрать все открытые жалобы"
              />
              {checked.size ? <span className="tabular-nums">Выбрано: {checked.size}</span> : <span className="text-muted-foreground">Выбрать все</span>}
            </label>
            {checked.size > 0 && (
              <div className="ml-auto flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => bulk("resolve")} disabled={busy}><Check className="text-up" /> Решить выбранные</Button>
                <Button size="sm" variant="outline" onClick={() => bulk("dismiss")} disabled={busy}><X /> Отклонить выбранные</Button>
                <Button size="sm" variant="ghost" onClick={() => setChecked(new Set())}>Снять выбор</Button>
              </div>
            )}
          </div>
        )}

        {isError ? (
          <QueryError error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label="Загрузка">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
          </div>
        ) : reports.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title={status === "open" ? "Очередь пуста — всё чисто" : "Жалоб с таким статусом нет"}
            description={status === "open" ? "Новые жалобы из обсуждений появятся здесь, счётчик — в меню слева." : undefined}
          />
        ) : (
          <ul ref={listRef} className="flex flex-col gap-2" aria-label="Жалобы">
            <AnimatePresence initial={false}>
              {reports.map((r, i) => (
                <motion.li
                  key={r.id}
                  data-idx={i}
                  layout={!reduce}
                  initial={reduce ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, x: 24, transition: { duration: 0.18 } }}
                  transition={{ duration: 0.2, ease: EASE }}
                  onClick={() => setSelected(i)}
                  aria-current={i === selected ? "true" : undefined}
                  className={cn(
                    "glass-panel group flex flex-col gap-3 rounded-xl p-4 transition-shadow",
                    i === selected && status === "open" && "ring-2 ring-primary/50",
                  )}
                >
                  <ReportCard r={r} busy={busy} act={act} checked={checked.has(r.id)} onToggle={() => toggleChecked(r.id)} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
      <ReasonDialog state={dialog} onClose={() => setDialog(null)} busy={busy} />
    </Panel>
  );
}

function ReportCard({
  r,
  busy,
  act,
  checked,
  onToggle,
}: {
  r: ContentReport;
  busy: boolean;
  act: Record<"resolve" | "dismiss" | "ban" | "remove", (r: ContentReport) => void>;
  checked: boolean;
  onToggle: () => void;
}) {
  const t = r.target;
  const isDiscussion = r.targetType === "discussion";
  const Icon = isDiscussion ? MessagesSquare : MessageCircle;
  const threadHref = t?.discussionId ? `/discussions?thread=${t.discussionId}` : null;
  const many = (r.openReportsOnTarget ?? 0) > 1;
  const canBan = !!t?.author && !t.authorBanned && t.authorRole !== "admin";

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {r.status === "open" && (
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 cursor-pointer accent-[hsl(var(--primary))]"
            checked={checked}
            onChange={onToggle}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Выбрать жалобу ${r.id}`}
          />
        )}
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--glass-bg)] text-muted-foreground">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {isDiscussion ? "Обсуждение" : "Комментарий"}
            {t?.title ? <span className="text-muted-foreground"> · «{t.title}»</span> : <span className="text-muted-foreground"> #{r.targetId}</span>}
          </div>
          <div className="text-xs text-muted-foreground">Жалоба #{r.id} · {timeAgo(r.createdAt)}</div>
        </div>
        {many && <Pill tone="down">{r.openReportsOnTarget} жалобы</Pill>}
        <Pill tone={r.status === "open" ? "warn" : r.status === "resolved" ? "up" : "neutral"} dot>{STATUS_LABEL[r.status] ?? r.status}</Pill>
      </div>

      {(t?.preview || t?.deleted) && (
        <blockquote className="rounded-xl border-l-2 border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2 text-sm">
          {t?.deleted
            ? <span className="italic text-muted-foreground">Контент уже удалён</span>
            : <span className="line-clamp-3 break-words text-foreground/90">{t?.preview}</span>}
          {t?.author && (
            <footer className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              Автор: <span className="font-medium text-foreground">{t.author}</span>
              {t.authorRole && t.authorRole !== "trader" && <Pill tone="accent">{ROLE_LABEL[t.authorRole] ?? t.authorRole}</Pill>}
              {t.authorBanned && <Pill tone="down">забанен</Pill>}
            </footer>
          )}
        </blockquote>
      )}

      <div className="text-sm">
        <span className="text-muted-foreground">{r.reporter}: </span>
        <span className="break-words">«{r.reason}»</span>
      </div>

      {r.resolution && (
        <div className="text-xs text-muted-foreground">
          {r.status === "dismissed" ? "Отклонено" : "Решено"}{r.resolvedBy ? ` · ${r.resolvedBy}` : ""}{r.resolvedAt ? ` · ${timeAgo(r.resolvedAt)}` : ""}: <span className="text-foreground/90">{r.resolution}</span>
        </div>
      )}

      {r.status === "open" && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--glass-border)] pt-3">
          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); act.resolve(r); }} disabled={busy}>
            <Check className="text-up" /> Решить
          </Button>
          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); act.dismiss(r); }} disabled={busy}>
            <X /> Отклонить
          </Button>
          <Button size="sm" variant="destructive" onClick={(e) => { e.stopPropagation(); act.ban(r); }} disabled={busy || !canBan} title={!canBan ? (t?.authorBanned ? "Автор уже забанен" : "Автора забанить нельзя") : undefined}>
            <Ban /> Бан автора
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="ml-auto h-8 w-8" aria-label={`Ещё действия по жалобе ${r.id}`} onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {threadHref && (
                <DropdownMenuItem asChild>
                  <Link href={threadHref}><ExternalLink /> Открыть обсуждение</Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!!t?.deleted} onSelect={() => act.remove(r)} className="text-down focus:text-down">
                <Trash2 /> Удалить контент и закрыть
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {r.status !== "open" && threadHref && (
        <Link href={threadHref} className="inline-flex w-fit items-center gap-1 text-xs text-primary hover:underline">
          <ExternalLink className="h-3 w-3" aria-hidden="true" /> Открыть обсуждение
        </Link>
      )}
    </>
  );
}
