/**
 * «Режимы рынка: рефлексия недели» — three questions per desk regime (how do I recognise it, which playbooks am I
 * competent in there, how much risk does it deserve), next to the trader's own numbers in that regime (edge by desk
 * regime). Answers are prefilled from the latest earlier week (the API marks `prefilledFrom`), saved with one button,
 * and shown read-only to the curator. Regimes start collapsed except today's one and the ones already answered.
 */
import * as React from "react";
import { useTextDraft } from "@/hooks/use-text-draft";
import { useQuery } from "@tanstack/react-query";
import { Compass } from "lucide-react";
import { Panel, Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { fmtNum, fmtRate, fmtUsd } from "@/lib/format";
import { REGIME_KEYS, type RegimeKey } from "@/lib/market-regime";
import { marketRegimeI18n } from "@/i18n/ns/marketRegime";
import {
  REFLECTION_QUESTIONS, reflectionQuery, regimeEdgeQuery, useSaveReflection,
  type Reflection, type ReflectionAnswers, type ReflectionQuestion, type RegimeEdgeRow,
} from "@/components/shared/regime/api";
import { REGIME_ICON, regimeName } from "@/components/shared/regime/labels";
import { EdgeStatusPill } from "@/components/shared/regime/regime-edge";

const TOTAL = REGIME_KEYS.length * REFLECTION_QUESTIONS.length;
const countAnswers = (a: ReflectionAnswers) => REGIME_KEYS.reduce((n, k) => n + REFLECTION_QUESTIONS.filter((q) => a[k]?.[q]?.trim()).length, 0);

function Numbers({ row }: { row: RegimeEdgeRow | undefined }) {
  const { t } = marketRegimeI18n.useT();
  if (!row) return <span className="text-xs text-muted-foreground">{t("reflection.noNumbers")}</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums text-muted-foreground" aria-label={t("reflection.myNumbers")}>
      <span className={cn("font-medium", row.net > 0 ? "text-up" : row.net < 0 ? "text-down" : "text-foreground")}>{fmtUsd(row.net, { signed: true, decimals: 0 })}</span>
      <span>WR {fmtRate(row.winRate)}</span>
      {row.expectancyR != null && <span>{fmtNum(row.expectancyR, { decimals: 2, signed: true })}R</span>}
      <span>{row.trades}</span>
      <EdgeStatusPill status={row.status} />
    </span>
  );
}

function RegimeBlock({ k, answers, row, editable, open, onChange }: {
  k: RegimeKey; answers: ReflectionAnswers; row: RegimeEdgeRow | undefined; editable: boolean; open: boolean;
  onChange: (k: RegimeKey, q: ReflectionQuestion, v: string) => void;
}) {
  const { t } = marketRegimeI18n.useT();
  const Icon = REGIME_ICON[k];
  return (
    <details open={open} className="tile group p-3 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="inline-flex items-center gap-2 text-sm font-medium">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {regimeName(k)}
        </span>
        <Numbers row={row} />
      </summary>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {REFLECTION_QUESTIONS.map((q) => {
          const v = answers[k]?.[q] ?? "";
          return (
            <label key={q} className="flex min-w-0 flex-col gap-1.5 text-xs text-muted-foreground">
              {t(`reflection.questions.${q}`)}
              {editable ? (
                <Textarea value={v} onChange={(e) => onChange(k, q, e.target.value)} maxLength={1000} rows={3} placeholder={t("reflection.placeholder")} className="text-sm" />
              ) : (
                <span className="whitespace-pre-wrap text-sm text-foreground">{v || "—"}</span>
              )}
            </label>
          );
        })}
      </div>
    </details>
  );
}

function Form({ data, rows, today, week }: { data: Reflection; rows: RegimeEdgeRow[]; today: RegimeKey | null; week: string }) {
  const { t } = marketRegimeI18n.useT();
  const [answers, setAnswers] = React.useState<ReflectionAnswers>(data.answers);
  const [dirty, setDirty] = React.useState(!!data.prefilledFrom && countAnswers(data.answers) > 0);
  const save = useSaveReflection(data.trader, week);
  const editable = data.canEdit;
  const byRegime = new Map(rows.map((r) => [r.regime, r] as const));
  const onChange = (k: RegimeKey, q: ReflectionQuestion, v: string) => {
    setAnswers((a) => ({ ...a, [k]: { ...a[k], [q]: v } }));
    setDirty(true);
  };
  // Unsaved answers survive a reload / a week switch (local draft until saved).
  const draft = useTextDraft(editable ? `regime-reflection:${data.trader}:${week}` : null, answers, (d) => { setAnswers(d); setDirty(true); }, { base: data.answers });
  const n = countAnswers(answers);
  if (!editable && n === 0) return <p className="text-sm text-muted-foreground">{t("reflection.emptyTrader")}</p>;
  // Regimes with something to look at first: today's, then answered / traded ones; the rest stay folded.
  const order = [...REGIME_KEYS].sort((a, b) => Number(b === today) - Number(a === today));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Pill tone={n === TOTAL ? "up" : "neutral"}>{t("reflection.answered", { count: n, total: TOTAL })}</Pill>
        {data.prefilledFrom && <span>{t("reflection.prefilled", { week: data.prefilledFrom })}</span>}
      </div>
      {order.map((k) => (
        <RegimeBlock
          key={k}
          k={k}
          answers={answers}
          row={byRegime.get(k)}
          editable={editable}
          open={k === today || REFLECTION_QUESTIONS.some((q) => answers[k]?.[q]) || (!editable ? false : byRegime.has(k))}
          onChange={onChange}
        />
      ))}
      {editable && (
        <div className="flex justify-end">
          <Button
            type="button"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate(answers, {
              onSuccess: () => { setDirty(false); draft.clear(); toast({ title: t("reflection.saved") }); },
              onError: () => toast({ title: t("reflection.failed"), variant: "destructive" }),
            })}
          >
            {t("reflection.save")}
          </Button>
        </div>
      )}
    </div>
  );
}

export function RegimeReflectionPanel({ trader, week, readOnly = false, className }: { trader: string; week: string; readOnly?: boolean; className?: string }) {
  const { t } = marketRegimeI18n.useT();
  const q = useQuery(reflectionQuery(trader, week));
  const edge = useQuery(regimeEdgeQuery(trader));
  if (q.isError) return null;
  const data = q.data ? { ...q.data, canEdit: q.data.canEdit && !readOnly } : null;
  return (
    <Panel title={t(data && !data.canEdit ? "reflection.readOnly" : "reflection.title")} description={t("reflection.description")} icon={Compass} className={className}>
      {data ? (
        <Form key={`${data.week}:${data.updatedAt ?? data.prefilledFrom ?? "new"}`} data={data} rows={edge.data?.rows ?? []} today={edge.data?.today ?? null} week={week} />
      ) : (
        <Skeleton className="h-40 w-full" />
      )}
    </Panel>
  );
}
