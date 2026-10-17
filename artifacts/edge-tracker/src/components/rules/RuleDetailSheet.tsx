import { useState } from "react";
import { Link } from "wouter";
import { ArrowUpRight, Pencil, Power, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ToastAction } from "@/components/ui/toast";
import { Pill, StatGrid } from "@/components/ds";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { links } from "@/lib/links";
import { nyDate } from "@/lib/trading-date";
import { apiJson, useSelfChecks } from "./api";
import { ORIGIN_LABEL, fmtDay, fmtPct, fmtUsd, originOf, severityMeta } from "./constants";
import { SelfMarkButtons } from "./RulesOverview";
import type { RuleReport, SideStats } from "./types";

export function RuleDetailSheet({
  rule,
  open,
  onOpenChange,
  trader,
  canMark,
  onEdit,
  onChanged,
}: {
  rule: RuleReport | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  trader: string;
  canMark: boolean;
  onEdit: (r: RuleReport) => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"disable" | "delete" | null>(null);
  const today = nyDate();
  const selfQ = useSelfChecks(trader, today, open && !!rule && !rule.auto && rule.enabled);
  if (!rule) return null;
  const r = rule;
  const origin = originOf(r);
  const o = ORIGIN_LABEL[origin];
  const editable = r.canEdit !== false;
  const mark = selfQ.data?.marks.find((m) => m.ruleId === r.id);
  const unit = r.auto ? "сделка" : "день";

  async function toggle() {
    setBusy(true);
    try {
      await apiJson(`/rules/${r.id}`, { method: "PATCH", json: { enabled: !r.enabled } }, "Не удалось изменить правило");
      toast({
        title: r.enabled ? "Правило выключено" : "Правило включено",
        description: r.enabled ? "Нарушения и комментарии сохранены в архиве" : undefined,
      });
      onChanged();
    } catch (e) {
      toast({ title: "Ошибка", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await apiJson(`/rules/${r.id}`, { method: "DELETE" }, "Не удалось удалить правило");
      onOpenChange(false);
      onChanged();
      toast({
        title: "Правило удалено",
        description: `${r.name} · нарушения и комментарии сохранены в архиве`,
        action: (
          <ToastAction
            altText="Вернуть правило"
            onClick={async () => {
              try {
                await apiJson(`/rules/${r.id}/restore`, { method: "POST" }, "Не удалось вернуть правило");
                onChanged();
              } catch (e) {
                toast({ title: "Ошибка", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
              }
            }}
          >
            Вернуть
          </ToastAction>
        ),
      });
    } catch (e) {
      toast({ title: "Ошибка", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const weekly = r.weekly.filter((w) => w.days > 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-5 sm:max-w-xl">
        <SheetHeader className="pr-10 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={o.tone} title={o.hint}>{o.label}</Pill>
            <span className="text-xs text-muted-foreground">{r.kindLabel}</span>
            {!r.enabled && <Pill>Выключено</Pill>}
          </div>
          <SheetTitle className="text-lg leading-snug">{r.name}</SheetTitle>
          <SheetDescription>{r.summary}{r.createdBy && origin !== "personal" ? ` · задал ${r.createdBy}` : ""}</SheetDescription>
          {r.note && <p className="text-sm italic text-muted-foreground">«{r.note}»</p>}
        </SheetHeader>

        {!r.auto && r.enabled && canMark && (
          <section className="tile flex flex-wrap items-center justify-between gap-3 p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Сегодня, {fmtDay(today)}</p>
              <p className="text-xs text-muted-foreground">Отметка попадает в журнал дня и в статистику правила.</p>
            </div>
            <SelfMarkButtons ruleId={r.id} trader={trader} day={today} mark={mark} size="md" />
          </section>
        )}

        {r.status === "disabled" ? (
          <p className="text-sm text-muted-foreground">
            Правило выключено — оно не проверяется и не попадает в статистику.
            {r.archivedViolations ? (
              <> Сохранено нарушений: <b className="tabular-nums text-foreground">{r.archivedViolations}</b> (с комментариями) — они в «Нарушения» → «Показать архив» с пометкой «правило выключено» и вернутся, если включить правило.</>
            ) : null}
          </p>
        ) : r.status === "no_data" ? (
          <p className="tile p-3 text-sm text-muted-foreground">
            По вашим сделкам это правило проверить нельзя — в них нет нужных данных (например, отдельных исполнений или стопа). Как только данные появятся, проверка начнётся сама.
          </p>
        ) : (
          <>
            <StatGrid min="9rem">
              <Metric label="Соблюдение" value={fmtPct(r.compliance)} hint={`${r.days - r.violatedDays} из ${r.days} дн.`} />
              <Metric label="Нарушений" value={String(r.violations)} hint={r.lastViolation ? `последнее ${fmtDay(r.lastViolation)}` : "ни одного"} />
              {r.auto ? (
                <Metric
                  label={r.impact != null && r.impact > 0 ? "Нарушения принесли" : "Стоит вам"}
                  value={r.impact == null ? "—" : fmtUsd(r.impact)}
                  valueClass={r.impact == null || r.impact === 0 ? "" : r.impact < 0 ? "text-down" : "text-up"}
                  hint="без нарушений итог был бы другим на эту сумму"
                />
              ) : (
                <Metric label="Чистых дней подряд" value={String(r.cleanStreak)} hint={r.unmarkedDays ? `не отмечено: ${r.unmarkedDays} дн.` : "все дни отмечены"} />
              )}
            </StatGrid>

            {r.broken.n > 0 && r.clean.n > 0 && (
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-foreground">Средний результат: {unit} с нарушением против без</h3>
                <CompareBars broken={r.broken} clean={r.clean} unit={unit} />
              </section>
            )}

            {weekly.length > 1 && (
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-foreground">Соблюдение по неделям</h3>
                <div className="flex h-24 items-end gap-1" role="img" aria-label="Соблюдение по неделям">
                  {weekly.map((w) => {
                    const c = w.compliance ?? 0;
                    return (
                      <div key={w.week} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`Неделя с ${fmtDay(w.week)}: ${fmtPct(w.compliance)} · нарушений ${w.violations}`}>
                        <div className="flex h-20 w-full items-end rounded-md bg-[var(--glass-bg)]">
                          <div className={cn("w-full rounded-md", c >= 0.9 ? "bg-primary" : c >= 0.7 ? "bg-primary/60" : "bg-warn")} style={{ height: `${Math.max(4, c * 100)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{fmtDay(weekly[0].week)}</span>
                  <span>{fmtDay(weekly[weekly.length - 1].week)}</span>
                </div>
              </section>
            )}

            {r.examples.length > 0 && (
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-foreground">{r.auto ? "Самые дорогие нарушения" : "Дни с нарушением"}</h3>
                <ul className="flex flex-col divide-y divide-[var(--glass-border)]">
                  {r.examples.map((ex) => (
                    <li key={ex.key} className="flex items-center gap-3 py-2">
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", severityMeta(ex.severity).bar)} aria-hidden="true" title={severityMeta(ex.severity).label} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-foreground">
                          {ex.ticker && <span className="font-medium">{ex.ticker} · </span>}
                          {ex.message}
                        </p>
                        <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                          <span>{fmtDay(ex.day)}</span>
                          {ex.tradeId != null && (
                            <Link href={links.trade(ex.tradeId)} className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
                              Сделка <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                            </Link>
                          )}
                          <Link href={links.dayReport(ex.day, trader)} className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
                            Разбор дня <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                          </Link>
                        </p>
                      </div>
                      {ex.net != null && (
                        <span className={cn("shrink-0 text-sm font-medium tabular-nums", ex.net < 0 ? "text-down" : ex.net > 0 ? "text-up" : "text-foreground")}>{fmtUsd(ex.net)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-[var(--glass-border)] pt-4">
          {editable ? (
            <>
              <Button variant="outline" size="sm" onClick={() => onEdit(r)} disabled={busy}><Pencil /> Изменить</Button>
              <Button variant="outline" size="sm" onClick={() => (r.enabled ? setConfirm("disable") : toggle())} disabled={busy}><Power /> {r.enabled ? "Выключить" : "Включить"}</Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirm("delete")} disabled={busy} className="ml-auto text-muted-foreground hover:text-down"><Trash2 /> Удалить</Button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Правило задал офис — изменить или выключить его может куратор.</p>
          )}
        </div>

        <AlertDialog open={confirm != null} onOpenChange={(v) => { if (!v) setConfirm(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirm === "delete" ? "Удалить правило?" : "Выключить правило?"}</AlertDialogTitle>
              <AlertDialogDescription>
                {confirm === "delete"
                  ? `«${r.name}» пропадёт из списка правил и перестанет проверяться. Найденные нарушения и комментарии к ним сохранятся: они уйдут в архив («Нарушения» → «Показать архив») и останутся в отчётах за прошлые недели. Правило можно вернуть.`
                  : `«${r.name}» перестанет проверяться и пропадёт из статистики. Найденные нарушения и комментарии к ним сохранятся — в архиве с пометкой «правило выключено». Если включить правило снова, они вернутся.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction
                className={confirm === "delete" ? buttonVariants({ variant: "destructive" }) : undefined}
                onClick={() => {
                  const what = confirm;
                  setConfirm(null);
                  if (what === "delete") void remove();
                  else if (what === "disable") void toggle();
                }}
              >
                {confirm === "delete" ? "Удалить" : "Выключить"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}

function Metric({ label, value, hint, valueClass }: { label: string; value: string; hint?: string; valueClass?: string }) {
  return (
    <div className="tile flex min-w-0 flex-col gap-0.5 p-3">
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <span className={cn("truncate text-xl font-semibold tabular-nums text-foreground", valueClass)}>{value}</span>
      {hint && <span className="line-clamp-2 text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function CompareBars({ broken, clean, unit }: { broken: SideStats; clean: SideStats; unit: string }) {
  const max = Math.max(Math.abs(broken.avg ?? 0), Math.abs(clean.avg ?? 0)) || 1;
  const row = (label: string, s: SideStats) => {
    const v = s.avg ?? 0;
    return (
      <div className="grid grid-cols-[148px_1fr_84px] items-center gap-2 text-xs">
        <span className="text-muted-foreground">{label} <span className="tabular-nums">({s.n})</span></span>
        <div className="relative h-3 rounded-full bg-[var(--glass-bg)]">
          <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--glass-border)]" aria-hidden="true" />
          <div
            className={cn("absolute inset-y-0 rounded-full", v < 0 ? "bg-down" : "bg-up")}
            style={v < 0 ? { right: "50%", width: `${(Math.abs(v) / max) * 50}%` } : { left: "50%", width: `${(v / max) * 50}%` }}
          />
        </div>
        <span className={cn("text-right font-medium tabular-nums", v < 0 ? "text-down" : v > 0 ? "text-up" : "text-foreground")}>{fmtUsd(s.avg)}</span>
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-1.5">
      {row(`с нарушением`, broken)}
      {row(`без нарушений`, clean)}
      <span className="text-xs text-muted-foreground">Средний нетто-результат на {unit === "сделка" ? "сделку" : "торговый день"}.</span>
    </div>
  );
}
