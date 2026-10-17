import * as React from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Layers, Moon, Repeat, ShieldAlert, ShieldCheck } from "lucide-react";
import {
  BentoGrid, DataTable, EmptyState, Panel, Pill, QueryState, SortableTh, StatCard, StatGrid, toneOf, useTableSort,
} from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { curatorApi, curatorKeys, useRiskSummary, useRiskTemplates, type RiskSummary, type TemplatesPayload } from "./api";
import { BreachReviewPanel } from "./breach-review";
import { shortDate, usd } from "./curator-math";
import { TemplateDialog } from "./template-dialog";
import { pluralRu } from "@/components/rules/constants";

/**
 * «Риск-процессы»: daily risk summary (GET /api/risk/summary), tier limit templates with bulk apply
 * (GET /api/risk/templates, POST /api/risk/templates/apply) and the desk-wide breach review list.
 */
export function RiskProcessesView({ onOpenTrader }: { onOpenTrader: (trader: string, tab?: string) => void }) {
  const summary = useRiskSummary();
  const templates = useRiskTemplates();
  const breaches = useQuery({ queryKey: curatorKeys.breaches(null), queryFn: () => curatorApi.breaches(null, 30), staleTime: 30_000, retry: false });

  return (
    <div className="flex flex-col gap-[var(--grid-gap)]">
      <QueryState query={summary} skeleton={<div className="h-28" aria-hidden="true" />} errorCompact>
        {(s) => <SummaryBlock s={s} onOpenTrader={onOpenTrader} />}
      </QueryState>

      <QueryState query={templates} skeleton={<div className="glass-panel h-64 rounded-2xl" aria-hidden="true" />} errorCompact>
        {(t) => <TemplatesBlock t={t} onOpenTrader={onOpenTrader} />}
      </QueryState>

      <QueryState query={breaches} skeleton={<div className="glass-panel h-40 rounded-2xl" aria-hidden="true" />} errorCompact>
        {(b) => (
          <BreachReviewPanel
            breaches={b.breaches}
            showTrader
            description="Стоп, недельный лимит и макс. просадка по деску. Повторные за 7 дней эскалируются руководителю."
            canReview={b.canReview}
            title={`Нарушения за 30 дней${b.unreviewed ? ` · без разбора ${b.unreviewed}` : ""}`}
          />
        )}
      </QueryState>
    </div>
  );
}

function SummaryBlock({ s, onOpenTrader }: { s: RiskSummary; onOpenTrader: (trader: string, tab?: string) => void }) {
  const t = s.totals;
  return (
    <>
      <StatGrid cols={6}>
        <StatCard label="Нетто деска" value={usd(t.pnlNetToday)} tone={toneOf(t.pnlNetToday)} hint={`торгуют ${t.trading} из ${t.traders}`} term="net" />
        <StatCard label="На стопе" value={s.halted.length} tone={s.halted.length ? "down" : "neutral"} icon={ShieldAlert} hint={s.nearStop.length ? `близко к стопу: ${s.nearStop.length}` : "никто не близко"} />
        <StatCard label="Нарушения" value={s.breachesToday.length} tone={s.breachesToday.length ? "down" : "neutral"} icon={AlertTriangle} hint={`сегодня · ${s.unreviewedBreaches.length ? `без разбора ${s.unreviewedBreaches.length}` : "все разобраны"}`} />
        <StatCard label="Повторные, 7 дн." value={s.repeatBreachers.length} tone={s.repeatBreachers.length ? "warn" : "neutral"} icon={Repeat} hint="→ руководителю" />
        <StatCard label="Открытый риск" value={usd(t.openRiskUsd, false)} icon={ShieldCheck} hint={`${t.openPositions} ${pluralRu(t.openPositions, "позиция", "позиции", "позиций")}`} term="openRisk" />
        <StatCard label="Овернайт" value={t.carriedTonight} tone={s.overnight.some((o) => o.allowed === false) ? "down" : "neutral"} icon={Moon} hint={t.overnightExposureUsd ? usd(t.overnightExposureUsd, false) : "нет экспозиции"} />
      </StatGrid>
      {(s.repeatBreachers.length > 0 || s.overnight.length > 0 || s.unreviewedBreaches.length > 0) && (
        <BentoGrid>
          <Panel className="lg:col-span-6" fill title="Требует решения" icon={AlertTriangle} description="Повторные нарушения и разборы, которые ещё не записаны">
            <ul className="flex flex-col gap-1.5">
              {s.repeatBreachers.map((r) => (
                <li key={`rep-${r.trader}`} className="flex items-center gap-2 text-sm">
                  <Pill tone="warn">Повторное</Pill>
                  <button type="button" className="font-medium text-foreground hover:text-primary" onClick={() => onOpenTrader(r.trader, "risk")}>{r.trader}</button>
                  <span className="min-w-0 flex-1 truncate text-xs tabular-nums text-muted-foreground">{r.days7} дн. с нарушением за 7 дней: {r.dates.map(shortDate).join(", ")}</span>
                </li>
              ))}
              {s.unreviewedBreaches.slice(0, 8).map((b) => (
                <li key={`b-${b.id}`} className="flex items-center gap-2 text-sm">
                  <Pill tone="down" dot>{b.kindLabel}</Pill>
                  <button type="button" className="font-medium text-foreground hover:text-primary" onClick={() => onOpenTrader(b.trader, "risk")}>{b.trader}</button>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{shortDate(b.date)} · нужен разбор</span>
                </li>
              ))}
              {s.repeatBreachers.length === 0 && s.unreviewedBreaches.length === 0 && <li className="text-sm text-muted-foreground">Всё разобрано.</li>}
            </ul>
          </Panel>
          <Panel className="lg:col-span-6" fill title="Овернайт" icon={Moon} description="Кто переносит позиции через ночь и разрешено ли это лимитами">
            {s.overnight.length === 0 ? (
              <p className="text-sm text-muted-foreground">Никто не переносит позиции.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {s.overnight.map((o) => (
                  <li key={o.trader} className="flex items-center gap-2 text-sm">
                    <button type="button" className="w-28 truncate text-left font-medium text-foreground hover:text-primary" onClick={() => onOpenTrader(o.trader, "risk")}>{o.trader}</button>
                    <span className="text-xs tabular-nums text-muted-foreground">{o.positions} поз. · {usd(o.exposureUsd, false)}{o.limitUsd != null ? ` из ${usd(o.limitUsd, false)}` : ""}</span>
                    <span className="ml-auto">{o.allowed === false ? <Pill tone="down">Не разрешено</Pill> : o.allowed ? <Pill tone="up">Разрешено</Pill> : <Pill tone="neutral">Лимитов нет</Pill>}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </BentoGrid>
      )}
    </>
  );
}

type TemplateRow = TemplatesPayload["traders"][number];
const TIER_ORDER: Record<string, number> = { trainee: 0, junior: 1, trader: 2, senior: 3 };
/** Проблемные строки (нет лимитов → нет тира → расхождение) поднимаются наверх при сортировке по возрастанию. */
const TEMPLATE_ACCESSORS = {
  trader: (r: TemplateRow) => r.trader,
  tier: (r: TemplateRow) => (r.tier ? TIER_ORDER[r.tier] ?? 9 : null),
  daily: (r: TemplateRow) => r.limits?.dailyLossLimit ?? null,
  weekly: (r: TemplateRow) => r.limits?.weeklyLossLimit ?? null,
  dd: (r: TemplateRow) => r.limits?.maxDrawdown ?? null,
  fit: (r: TemplateRow) => (!r.hasLimits ? 0 : !r.tier ? 1 : r.drift.length ? 2 : 3),
};

function TemplatesBlock({ t, onOpenTrader }: { t: TemplatesPayload; onOpenTrader: (trader: string, tab?: string) => void }) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [dialog, setDialog] = React.useState<{ traders: string[]; tier: string | null } | null>(null);
  const ladder = t.tiers.filter((x) => ["trainee", "junior", "trader", "senior"].includes(x.key));
  const needs = t.traders.filter((r) => !r.hasLimits || r.drift.length > 0 || !r.tier);
  const toggle = (name: string) => setSelected((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  const allOn = t.traders.length > 0 && t.traders.every((r) => selected.has(r.trader));
  const { rows, thProps } = useTableSort(t.traders, TEMPLATE_ACCESSORS, "fit", "asc");

  return (
    <BentoGrid>
      <Panel
        className="lg:col-span-8"
        fill
        title="Лимиты по тирам"
        icon={Layers}
        description="Шаблон тира задаёт все лимиты одним действием: журнал изменений, аудит и уведомление трейдеру"
        actions={t.canEdit ? (
          <div className="flex items-center gap-2">
            {needs.length > 0 && (
              <Button type="button" size="sm" variant="outline" onClick={() => setDialog({ traders: needs.map((r) => r.trader), tier: null })}>
                Исправить {needs.length}
              </Button>
            )}
            <Button type="button" size="sm" disabled={!selected.size} onClick={() => setDialog({ traders: [...selected], tier: null })}>
              <Layers className="h-3.5 w-3.5" /> Применить шаблон{selected.size ? ` (${selected.size})` : ""}
            </Button>
          </div>
        ) : <Pill tone="neutral">только просмотр</Pill>}
      >
        {t.traders.length === 0 ? (
          <EmptyState compact icon={Layers} title="Трейдеров нет" />
        ) : (
          <DataTable ariaLabel="Лимиты трейдеров и шаблоны тиров" maxHeight="65vh">
            <table>
              <thead>
                <tr>
                  {t.canEdit && (
                    <th className="w-8">
                      <Checkbox
                        checked={allOn}
                        onCheckedChange={(v) => setSelected(v ? new Set(t.traders.map((r) => r.trader)) : new Set())}
                        aria-label="Выбрать всех"
                      />
                    </th>
                  )}
                  <SortableTh {...thProps("trader")}>Трейдер</SortableTh>
                  <SortableTh {...thProps("tier")}>Тир</SortableTh>
                  <SortableTh {...thProps("daily")} align="right">Дневной</SortableTh>
                  <SortableTh {...thProps("weekly")} align="right">Недельный</SortableTh>
                  <SortableTh {...thProps("dd")} align="right">Просадка</SortableTh>
                  <SortableTh {...thProps("fit")}>Соответствие шаблону</SortableTh>
                  {t.canEdit && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.trader} className={cn(selected.has(r.trader) && "bg-primary/5")}>
                    {t.canEdit && (
                      <td><Checkbox checked={selected.has(r.trader)} onCheckedChange={() => toggle(r.trader)} aria-label={`Выбрать ${r.trader}`} /></td>
                    )}
                    <td><button type="button" className="font-medium text-foreground hover:text-primary" onClick={() => onOpenTrader(r.trader, "risk")}>{r.trader}</button></td>
                    <td className="text-muted-foreground">{r.tierName ?? "—"}</td>
                    <td className="text-right">{usd(r.limits?.dailyLossLimit, false)}</td>
                    <td className="text-right">{usd(r.limits?.weeklyLossLimit, false)}</td>
                    <td className="text-right">{usd(r.limits?.maxDrawdown, false)}</td>
                    <td className="min-w-[10rem] max-w-[20rem]">
                      {!r.hasLimits ? <Pill tone="warn">Лимитов нет</Pill>
                        : !r.tier ? <Pill tone="neutral">Тир не назначен</Pill>
                        : r.drift.length ? <span className="block whitespace-normal break-words text-xs text-warn">Отличается: {r.drift.map((d) => d.label).join(", ")}</span>
                        : <Pill tone="up">Совпадает</Pill>}
                    </td>
                    {t.canEdit && (
                      <td className="text-right">
                        <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setDialog({ traders: [r.trader], tier: r.tier })}>Шаблон</Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTable>
        )}
      </Panel>
      <Panel className="lg:col-span-4" fill title="Лестница тиров" icon={ShieldCheck} description="Стажёр → Джун → Трейдер → Сеньор" actions={<Button asChild size="sm" variant="ghost"><Link href="/scaling">Скейлинг <ArrowRight className="h-3.5 w-3.5" /></Link></Button>}>
        <ul className="flex flex-col gap-2">
          {ladder.map((x) => (
            <li key={x.key} className="tile flex flex-col gap-0.5 p-2.5">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-foreground">{x.stageLabel ?? x.name}</span>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">{t.traders.filter((r) => r.tier === x.key).length} чел.</span>
              </div>
              <p className="text-xs tabular-nums text-muted-foreground">
                день {usd(x.dailyLossLimit, false)} · неделя {usd(x.weeklyLossLimit, false)} · просадка {usd(x.maxDrawdown, false)} · {x.allowOvernight ? "овернайт да" : "без овернайта"}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          Эскалация: 70% лимита — предупреждение трейдеру; 100% — стоп и уведомление куратору; повторное нарушение за 7 дней — руководителю деска. Ручная правка лимитов — в <Link href="/risk" className="text-primary hover:underline">риск-деске</Link>.
        </p>
      </Panel>
      <TemplateDialog
        open={!!dialog}
        onOpenChange={(v) => { if (!v) { setDialog(null); setSelected(new Set()); } }}
        traders={dialog?.traders ?? []}
        defaultTier={dialog?.tier ?? null}
      />
    </BentoGrid>
  );
}
