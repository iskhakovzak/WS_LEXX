/**
 * The idea of one planned ticker (own plan): tier 1 / 2 / 3, «authored», the playbook setup it is played as and that
 * setup's checklist with its score. Plans are where manual input belongs; everything else is prefilled — «authored» is
 * suggested when the ticker is not in the desk plan (drawn dashed, a tap confirms), a first tier comes from the setup's
 * own edge, the checklist items the day's data confirms are ticked («авто»). Ends with the result: the score against the
 * threshold, the suggested risk (cut below the threshold) and the limits of an authored / tier-3 idea.
 */
import { useQuery } from "@tanstack/react-query";
import { Check, Lightbulb } from "lucide-react";
import { Pill, toneText } from "@/components/ds";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { fmtNum, fmtUsd } from "@/lib/format";
import { sessionFlowI18n } from "@/i18n/ns/sessionFlow";
import { ideaDayQuery, useSaveIdea, type Idea, type Tier } from "./ideas-api";

const TICKER_RE = /^[A-Z0-9][-A-Z0-9.]{0,11}$/;
const NONE = "__none";
const chip = "h-7 rounded-full border px-2.5 text-xs transition-colors duration-[var(--dur-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const on = "border-primary/60 bg-primary/15 font-medium text-foreground";
const off = "border-[var(--field-border)] text-muted-foreground hover:bg-[var(--glass-hover-bg)]";

function Checklist({ idea, toggle }: { idea: Idea; toggle: (id: string, v: boolean) => void }) {
  const { t } = sessionFlowI18n.useT();
  const c = idea.checklist;
  if (!c) return null;
  const s = c.score;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <ul className="flex flex-wrap gap-1.5">
        {c.items.map((i) => (
          <li key={i.id}>
            <button type="button" aria-pressed={i.checked} onClick={() => toggle(i.id, !i.checked)} title={i.prefilled ? t("idea.autoHint") : undefined}
              className={cn(chip, "inline-flex max-w-[16rem] items-center gap-1", i.checked ? on : off)}>
              {i.checked && <Check className="h-3 w-3 shrink-0" aria-hidden="true" />}
              <span className="truncate">{i.text}</span>
              {i.weight > 1 && <span className="tabular-nums text-muted-foreground">{t("idea.weight", { weight: i.weight })}</span>}
              {i.prefilled && <span className="text-2xs text-muted-foreground">{t("idea.auto")}</span>}
            </button>
          </li>
        ))}
      </ul>
      {s && (
        <p className="flex flex-wrap items-center gap-2 text-xs tabular-nums" role="status">
          <Pill tone={s.passed ? "up" : "warn"}>{t("idea.score", { score: fmtNum(s.score, 0), max: fmtNum(s.max, 0), threshold: fmtNum(s.threshold, 0) })}</Pill>
          {idea.risk.usd != null && (
            <span className={idea.risk.reduced ? toneText("warn") : "text-muted-foreground"}>
              {idea.risk.reduced ? t("idea.riskReduced", { usd: fmtUsd(idea.risk.usd, { decimals: 0 }), factor: fmtNum(idea.risk.factor ?? null, 2) }) : t("idea.risk", { usd: fmtUsd(idea.risk.usd, { decimals: 0 }) })}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

export function IdeaTaps({ ticker: raw, date, planBias, className }: { ticker: string; date: string; planBias?: string | null; className?: string }) {
  const { t } = sessionFlowI18n.useT();
  const ticker = raw.trim().toUpperCase();
  const valid = TICKER_RE.test(ticker);
  const q = useQuery({ ...ideaDayQuery(date, ticker), enabled: valid });
  const save = useSaveIdea(date, ticker);
  if (!valid || !q.data) return null;
  const idea = q.data.ideas.find((i) => i.ticker === ticker) ?? null;
  const suggestAuthored = !idea && q.data.suggest[ticker]?.authored === true;
  const side = planBias === "bull" ? "long" : planBias === "bear" ? "short" : null;
  const put = (b: { tier?: Tier | null; authored?: boolean; setupId?: number | null; checks?: Record<string, boolean> }) =>
    save.mutate({ date, ticker, side, ...(idea ? {} : { authored: suggestAuthored }), ...b });
  const authored = idea ? idea.authored : false;
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />{t("idea.label")}</span>
        <span role="group" aria-label={t("idea.tierAria", { ticker })} className="inline-flex gap-1">
          {([1, 2, 3] as const).map((k) => (
            <button key={k} type="button" aria-pressed={idea?.tier === k} title={t(`idea.tierHint.${k}`)} onClick={() => put({ tier: idea?.tier === k ? null : k })}
              className={cn(chip, idea?.tier === k ? on : off)}>{t(`idea.tier.${k}`)}</button>
          ))}
        </span>
        <button type="button" aria-pressed={authored} title={suggestAuthored ? t("idea.suggested") : t("idea.authoredHint")} onClick={() => put({ authored: !authored })}
          className={cn(chip, authored ? on : off, suggestAuthored && "border-dashed text-foreground")}>{t("idea.authored")}</button>
        {q.data.setups.length > 0 && (
          <Select value={idea?.setupId != null ? String(idea.setupId) : NONE} onValueChange={(v) => put({ setupId: v === NONE ? null : Number(v) })}>
            <SelectTrigger aria-label={t("idea.setup")} className="h-7 w-auto min-w-[9rem] gap-1.5 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t("idea.noSetup")}</SelectItem>
              {q.data.setups.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>
      {idea && <Checklist idea={idea} toggle={(id, v) => put({ checks: { [id]: v } })} />}
      {idea?.limits.limited && (
        <p className={cn("text-xs", toneText("warn"))}>{idea.limits.maxLossUsd != null ? t("idea.limits", { usd: fmtUsd(idea.limits.maxLossUsd, { decimals: 0 }) }) : t("idea.limitsNoStop")}</p>
      )}
    </div>
  );
}
