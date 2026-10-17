import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Archive, BookOpen, CalendarDays, Check, ShieldAlert, ShieldCheck, Undo2, X } from "lucide-react";
import { EmptyState, FilterChip, Panel, Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { links } from "@/lib/links";
import { apiJson } from "./api";
import { RULE_PREFIX, VIOLATION_ARCHIVE, VIOLATION_RESOLUTION, VIOLATION_STATUS, fmtR, fmtUsd, severityMeta } from "./constants";
import { countedViolations, violationDay, withArchive } from "./discipline";
import type { MistakePrefill, Severity, Violation, ViolationStatus } from "./types";

type StatusFilter = "all" | ViolationStatus;
const NO_VIOLATIONS: Violation[] = [];

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "open", label: "Новые" },
  { value: "acknowledged", label: "Принятые" },
  { value: "resolved", label: "Решённые" },
];

export function ViolationsList({
  violations: activeViolations,
  archived = NO_VIOLATIONS,
  showArchive = false,
  archiveLoading = false,
  onToggleArchive,
  hasRules,
  trader,
  viewerName,
  isStaff,
  onLogMistake,
  onOpenRules,
  onChanged,
}: {
  /** Active violations (counted). */
  violations: Violation[];
  /** Archived violations (rule disabled / deleted, stale) — shown only with «Показать архив». */
  archived?: Violation[];
  showArchive?: boolean;
  archiveLoading?: boolean;
  onToggleArchive?: (v: boolean) => void;
  hasRules: boolean;
  /** Trader whose violations are shown. */
  trader: string;
  /** Logged-in user's name (null for guests). */
  viewerName: string | null;
  isStaff: boolean;
  onLogMistake: (p: MistakePrefill) => void;
  onOpenRules: () => void;
  onChanged: () => void;
}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [ruleFilter, setRuleFilter] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [consequence, setConsequence] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const isOwner = !!viewerName && viewerName === trader;
  // Archived rows are listed after the active ones but never counted as «новые».
  const violations = useMemo(() => withArchive(activeViolations, archived, showArchive), [activeViolations, archived, showArchive]);
  const openCount = countedViolations(activeViolations).filter((v) => v.status === "open").length;
  const archiveToggle = onToggleArchive ? (
    <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
      <Switch checked={showArchive} onCheckedChange={onToggleArchive} aria-label="Показать архив" className="scale-90" />
      <span>Показать архив{showArchive && !archiveLoading ? <span className="tabular-nums"> · {archived.length}</span> : null}</span>
    </label>
  ) : null;

  const byRule = useMemo(() => {
    const m = new Map<number, { name: string; count: number }>();
    for (const v of violations) {
      const e = m.get(v.ruleId) ?? { name: v.ruleName ?? "Правило", count: 0 };
      e.count++;
      m.set(v.ruleId, e);
    }
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [violations]);

  const groups = useMemo(() => {
    const list = violations.filter((v) => (ruleFilter == null || v.ruleId === ruleFilter) && (statusFilter === "all" || v.status === statusFilter));
    const g = new Map<string, Violation[]>();
    for (const v of list) {
      const d = violationDay(v);
      if (!g.has(d)) g.set(d, []);
      g.get(d)!.push(v);
    }
    return [...g.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [violations, ruleFilter, statusFilter]);

  function openActions(v: Violation) {
    if (activeId === v.id) { setActiveId(null); return; }
    setActiveId(v.id);
    setComment(v.comment ?? "");
    setConsequence(v.consequence ?? "");
  }

  async function patch(v: Violation, body: Record<string, unknown>, okTitle: string) {
    setBusyId(v.id);
    try {
      await apiJson(`/rule-violations/${v.id}`, { method: "PATCH", json: body }, "Не удалось обновить нарушение");
      toast({ title: okTitle, description: v.ruleName ?? v.message });
      setActiveId(null);
      onChanged();
    } catch (e) {
      toast({ title: "Ошибка", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  if (violations.length === 0) {
    return (
      <div className="flex flex-col gap-3">
      {archiveToggle && (
        <div className="flex items-center">
          {showArchive && !archiveLoading && <span className="text-xs text-muted-foreground">В архиве пусто</span>}
          {archiveToggle}
        </div>
      )}
      <Panel>
        <EmptyState
          icon={hasRules ? ShieldCheck : ShieldAlert}
          title={hasRules ? "Нарушений не найдено" : "Нет правил для проверки"}
          description={
            hasRules
              ? "Все сделки соответствуют вашим правилам. Новые сделки проверяются автоматически."
              : "Задайте правила — каждая сделка будет проверяться автоматически: лимит сделок, стоп-день после серии убытков, размер позиции, дневной лимит убытка."
          }
          action={!hasRules ? <Button variant="outline" onClick={onOpenRules}>Добавить правило</Button> : undefined}
        />
      </Panel>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Фильтр по статусу">
          {STATUS_FILTERS.map((f) => {
            const n = f.value === "all" ? violations.length : violations.filter((v) => v.status === f.value).length;
            if (f.value !== "all" && n === 0 && statusFilter !== f.value) return null;
            return (
              <FilterChip key={f.value} active={statusFilter === f.value} onClick={() => setStatusFilter(f.value)} count={n} className="min-h-7 px-2.5 text-xs">
                {f.label}
              </FilterChip>
            );
          })}
        </div>
        {isOwner && openCount > 0 && (
          <span className="text-xs text-muted-foreground">
            Новых нарушений: <span className="font-semibold text-foreground tabular-nums">{openCount}</span> — отметьте «Принято» и объясните, что произошло
          </span>
        )}
        {archiveToggle}
      </div>

      {byRule.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Фильтр по правилу">
          <FilterChip active={ruleFilter == null} onClick={() => setRuleFilter(null)} count={violations.length} className="min-h-7 px-2.5 text-xs">
            Все правила
          </FilterChip>
          {byRule.map(([id, r]) => (
            <FilterChip key={id} active={ruleFilter === id} onClick={() => setRuleFilter(ruleFilter === id ? null : id)} count={r.count} className="min-h-7 px-2.5 text-xs">
              {r.name}
            </FilterChip>
          ))}
        </div>
      )}

      {groups.length === 0 && (
        <Panel>
          <EmptyState icon={ShieldCheck} title="Ничего не найдено" description="Под выбранные фильтры нарушения не попали." />
        </Panel>
      )}

      {groups.map(([date, list]) => {
        const counted = countedViolations(list);
        const dayCost = counted.reduce((s, v) => s + (v.costNet ?? 0), 0);
        const hasCost = counted.some((v) => v.costNet != null);
        return (
          <section key={date} className="flex flex-col gap-2">
            <h3 className="micro-label flex flex-wrap items-center gap-2 px-1">
              <button
                type="button"
                className="inline-flex items-center gap-1 underline-offset-4 hover:text-primary hover:underline"
                title="Открыть разбор дня"
                onClick={() => navigate(links.dayReport(date, trader))}
              >
                <CalendarDays className="size-3" aria-hidden="true" />
                {new Date(`${date}T12:00:00`).toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long" })}
              </button>
              <span className="normal-case tracking-normal">· {list.length}</span>
              {hasCost && dayCost !== 0 && (
                <span className={cn("normal-case tracking-normal tabular-nums", dayCost < 0 ? "text-down" : "text-up")}>· {fmtUsd(dayCost)} нетто</span>
              )}
            </h3>
            <ul className="flex flex-col gap-2">
              {list.map((v) => {
                const sev = severityMeta(v.severity);
                const st = VIOLATION_STATUS[v.status] ?? VIOLATION_STATUS.open;
                const res = v.resolution ? VIOLATION_RESOLUTION[v.resolution] : null;
                const active = activeId === v.id;
                const busy = busyId === v.id;
                const arch = v.archived ? VIOLATION_ARCHIVE[v.archivedReason ?? "stale"] ?? VIOLATION_ARCHIVE.stale : null;
                const canAck = isOwner && v.status === "open" && !arch;
                const canResolve = isStaff && v.resolution == null;
                const canReopen = isStaff && v.resolution != null;
                const canAct = canAck || canResolve || canReopen || (isOwner && v.status === "acknowledged");
                return (
                  <li key={v.id} className={cn("glass-panel relative overflow-hidden rounded-2xl p-4 pl-5", (v.resolution === "dismissed" || arch) && "opacity-70")}>
                    <span className={cn("absolute inset-y-0 left-0 w-1", sev.bar)} aria-hidden="true" />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{v.ruleName ?? "Правило"}</span>
                      <Pill tone={sev.tone}>{sev.label}</Pill>
                      {res ? <Pill tone={res.tone} dot>{res.label}</Pill> : <Pill tone={st.tone} dot>{st.label}</Pill>}
                      {arch && <Pill tone="neutral" className="opacity-80" title={arch.hint}><Archive className="size-3" aria-hidden="true" />{arch.label}</Pill>}
                      {v.tradeId && (
                        <button
                          type="button"
                          onClick={() => navigate(links.trade(v.tradeId!))}
                          className="chip inline-flex min-h-6 items-center gap-1 px-2 text-xs font-medium"
                          title="Открыть сделку"
                        >
                          {v.ticker ?? `#${v.tradeId}`}
                          {v.tradeNetPnl != null ? (
                            <span className={v.tradeNetPnl < 0 ? "text-down" : v.tradeNetPnl > 0 ? "text-up" : ""}>{fmtUsd(v.tradeNetPnl)}</span>
                          ) : v.tradeR != null ? (
                            <span className={v.tradeR < 0 ? "text-down" : "text-up"}>{fmtR(v.tradeR)}</span>
                          ) : null}
                        </button>
                      )}
                      {v.playbookId != null && (
                        <button
                          type="button"
                          onClick={() => navigate(links.setup(v.playbookId!))}
                          className="chip inline-flex min-h-6 items-center gap-1 px-2 text-xs"
                          title="Открыть сетап в плейбуке"
                        >
                          <BookOpen className="size-3" aria-hidden="true" />
                          {v.playbookName ?? v.tradeSetup ?? "сетап"}
                        </button>
                      )}
                      {v.costNet != null && v.costNet !== 0 && (
                        <span className={cn("text-xs font-semibold tabular-nums", v.costNet < 0 ? "text-down" : "text-up")} title="Цена нарушения, нетто">
                          {fmtUsd(v.costNet)} нетто
                        </span>
                      )}
                      <div className="ml-auto flex items-center gap-1">
                        {canAct && (
                          <Button variant={canAck ? "outline" : "ghost"} size="sm" disabled={busy} onClick={() => openActions(v)} aria-expanded={active}>
                            {canAck ? "Принять" : isStaff ? "Решение" : "Комментарий"}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Записать в журнал ошибок с уроком"
                          onClick={() =>
                            onLogMistake({
                              errorType: `${RULE_PREFIX}${v.ruleName ?? "правило"}`,
                              description: v.message,
                              tradeId: v.tradeId,
                              ticker: v.ticker,
                              severity: (["low", "medium", "high", "critical"].includes(v.severity) ? v.severity : "high") as Severity,
                            })
                          }
                        >
                          В журнал
                        </Button>
                      </div>
                    </div>
                    <p className="mt-1 break-words text-sm text-muted-foreground">{v.message}</p>

                    {(v.comment || v.consequence || v.acknowledgedAt || v.resolvedAt) && !active && (
                      <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                        {v.acknowledgedAt && (
                          <span>Принято {v.acknowledgedBy ? `· ${v.acknowledgedBy}` : ""} · {fmtWhen(v.acknowledgedAt)}</span>
                        )}
                        {v.comment && <p className="break-words text-foreground">«{v.comment}»</p>}
                        {v.resolvedAt && (
                          <span>{res?.label ?? "Решено"} {v.resolvedBy ? `· ${v.resolvedBy}` : ""} · {fmtWhen(v.resolvedAt)}</span>
                        )}
                        {v.consequence && <p className="break-words"><span className="font-medium text-foreground">Последствие:</span> {v.consequence}</p>}
                      </div>
                    )}

                    {active && (
                      <div className="mt-3 flex flex-col gap-2 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
                        <label className="text-xs text-muted-foreground" htmlFor={`v-comment-${v.id}`}>
                          {isOwner ? "Что произошло и почему (видит куратор)" : "Комментарий куратора"}
                        </label>
                        <Textarea
                          id={`v-comment-${v.id}`}
                          rows={2}
                          maxLength={2000}
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          placeholder={isOwner ? "Например: взял сделку сверх лимита после двух стопов — эмоции" : "Разбор на 1:1, договорённость с трейдером"}
                        />
                        {isStaff && (
                          <>
                            <label className="text-xs text-muted-foreground" htmlFor={`v-cons-${v.id}`}>Последствие (если подтверждено)</label>
                            <Textarea
                              id={`v-cons-${v.id}`}
                              rows={1}
                              maxLength={2000}
                              value={consequence}
                              onChange={(e) => setConsequence(e.target.value)}
                              placeholder="Например: размер позиции −50% на неделю"
                            />
                          </>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          {canAck && (
                            <Button size="sm" disabled={busy} onClick={() => patch(v, { acknowledged: true, comment: comment.trim() || null }, "Нарушение принято")}>
                              <Check /> Принято
                            </Button>
                          )}
                          {isOwner && v.status === "acknowledged" && (
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => patch(v, { comment: comment.trim() || null }, "Комментарий сохранён")}>
                              Сохранить комментарий
                            </Button>
                          )}
                          {canResolve && (
                            <>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={busy}
                                onClick={() => patch(v, { resolution: "upheld", consequence: consequence.trim() || null, comment: comment.trim() || null }, "Нарушение подтверждено")}
                              >
                                <Check /> Подтвердить
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => patch(v, { resolution: "dismissed", comment: comment.trim() || null }, "Нарушение снято")}
                              >
                                <X /> Снять
                              </Button>
                            </>
                          )}
                          {canReopen && (
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch(v, { resolution: null, comment: comment.trim() || null }, "Решение отменено")}>
                              <Undo2 /> Вернуть в работу
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={() => setActiveId(null)}>Отмена</Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" });
}
