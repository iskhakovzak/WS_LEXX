import * as React from "react";
import { MessageSquare, ThumbsUp, ThumbsDown, AlertTriangle, Target, ShieldAlert, Briefcase, RotateCcw, Hourglass } from "lucide-react";
import { Pill, type Tone } from "@/components/ds";
import { cn } from "@/lib/utils";
import { LevelsBar } from "./LevelsBar";
import {
  QUALITY_TONE, SIDE_TONE, STAGE_BY_KEY, fmtPrice, fmtValidUntil, ideaHorizon, horizonLabel, fmtR, ideaPlan, initials, linkedR, normalizeTradeResult, relTime, rrTone, scoreTone,
  type IdeaTracking, type Stage, type TradeIdea,
} from "./model";

const ACCENT_BAR: Record<Tone, string> = {
  up: "bg-up",
  down: "bg-down",
  accent: "bg-primary",
  warn: "bg-[hsl(var(--chart-3))]",
  purple: "bg-[hsl(var(--chart-5))]",
  neutral: "bg-[var(--field-border)]",
};

export function Avatar({ name, className }: { name: string | null | undefined; className?: string }) {
  return (
    <span
      className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/15 text-2xs font-semibold text-primary", className)}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

/** Highlights the first case-insensitive match of `q` inside `text`. */
export function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-primary/25 px-0.5 text-foreground">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export function OutcomeChips({ idea, tracking }: { idea: TradeIdea; tracking?: IdeaTracking | null }) {
  const chips: React.ReactNode[] = [];
  if (idea.linkedTrade) {
    const o = normalizeTradeResult(idea.linkedTrade.result);
    const r = linkedR(idea.linkedTrade);
    const label = o === "win" ? "Сделка в плюсе" : o === "loss" ? "Сделка в минусе" : o === "breakeven" ? "Сделка в ноль" : "Сделка открыта";
    chips.push(
      <Pill key="trade" tone={o === "win" ? "up" : o === "loss" ? "down" : o === "open" ? "accent" : "neutral"}>
        <Briefcase className="h-3 w-3" aria-hidden="true" />
        {label}
        {r != null && Number.isFinite(r) && <span className="opacity-90">{fmtR(r, 2)}</span>}
      </Pill>,
    );
  }
  if (tracking?.hit) {
    const isStop = tracking.hit === "stop";
    const when = tracking.hitAt ? new Date(tracking.hitAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) : "";
    chips.push(
      <Pill key="hit" tone={isStop ? "down" : "up"}>
        {isStop ? <ShieldAlert className="h-3 w-3" aria-hidden="true" /> : <Target className="h-3 w-3" aria-hidden="true" />}
        {isStop ? "Стоп задет" : tracking.hit === "final_target" ? "Все цели" : "Цель 1"}
        {when && <span className="opacity-80">· {when}</span>}
        {tracking.ambiguous && <span className="opacity-80" title="Цель и стоп задеты в одной часовой свече — засчитан стоп">?</span>}
      </Pill>,
    );
  } else if (tracking && tracking.rNow != null) {
    chips.push(
      <Pill key="live" tone={tracking.rNow > 0 ? "up" : tracking.rNow < 0 ? "down" : "neutral"}>
        <span className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse" aria-hidden="true" />
        {fmtPrice(tracking.price)} · {fmtR(tracking.rNow)}
      </Pill>,
    );
  }
  if (idea.expired && !idea.linkedTrade && !tracking?.hit) {
    chips.push(
      <span key="expired" title={idea.validUntil ? `Действовала до ${fmtValidUntil(idea.validUntil)}` : undefined}>
        <Pill tone="neutral"><Hourglass className="h-3 w-3" aria-hidden="true" />Истекла</Pill>
      </span>,
    );
  }
  if (!chips.length) return null;
  return <div className="flex flex-wrap items-center gap-1.5">{chips}</div>;
}

export function IdeaCard({
  idea,
  stage,
  tracking,
  onOpen,
  query = "",
  showStage = false,
  selected = false,
}: {
  idea: TradeIdea;
  stage: Stage;
  tracking?: IdeaTracking | null;
  onOpen: (idea: TradeIdea) => void;
  query?: string;
  showStage?: boolean;
  selected?: boolean;
}) {
  const plan = ideaPlan(idea);
  const st = STAGE_BY_KEY[stage];
  const up = idea.reactions.filter((r) => r.reaction === "thumbs_up").length;
  const warn = idea.reactions.filter((r) => r.reaction === "warning").length;
  const down = idea.reactions.filter((r) => r.reaction === "thumbs_down").length;
  const comments = idea.commentCount ?? 0;
  const unread = idea.unreadCount ?? 0;

  return (
    <button
      type="button"
      onClick={() => onOpen(idea)}
      aria-label={`${idea.ticker} ${idea.side ?? ""}, ${st.label}${idea.trader ? `, автор ${idea.trader}` : ""}. Открыть идею`}
      className={cn(
        "glass-panel lift group relative flex w-full min-w-0 flex-col gap-2.5 overflow-hidden rounded-xl p-3 pl-4 text-left",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "ring-1 ring-primary",
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-0.5", ACCENT_BAR[st.tone])} aria-hidden="true" />

      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="text-base font-semibold tracking-tight text-foreground">
            <Highlight text={idea.ticker} q={query} />
          </span>
          {idea.side && <Pill tone={SIDE_TONE(idea.side)}>{idea.side}</Pill>}
          {idea.setupQuality && <Pill tone={QUALITY_TONE[idea.setupQuality] ?? "neutral"}>{idea.setupQuality}</Pill>}
          {ideaHorizon(idea) && <Pill tone="purple">{horizonLabel(ideaHorizon(idea))}</Pill>}
          {showStage && <Pill tone={st.tone} dot>{st.label}</Pill>}
          {idea.review_status === "needs_work" && stage === "review" && (
            <Pill tone="warn"><RotateCcw className="h-3 w-3" aria-hidden="true" />Доработка</Pill>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {idea.score != null && (
            <Pill tone={scoreTone(idea.score)} className="px-1.5" >
              <span className="sr-only">Score </span>{idea.score}
            </Pill>
          )}
          {plan.rr != null && <Pill tone={rrTone(plan.rr)}>R:R {plan.rr.toFixed(1)}</Pill>}
        </div>
      </div>

      {idea.setup && (
        <p className="-mt-1 truncate text-xs text-muted-foreground">
          <Highlight text={idea.setup} q={query} />
        </p>
      )}

      {(idea.entryZone || idea.target || idea.stop) && (
        <div className="grid grid-cols-3 gap-2 text-xs tabular-nums">
          <div className="min-w-0">
            <div className="text-2xs text-muted-foreground">Вход</div>
            <div className="truncate font-medium text-foreground">{idea.entryZone || "—"}</div>
          </div>
          <div className="min-w-0">
            <div className="text-2xs text-muted-foreground">Цель</div>
            <div className="truncate font-medium text-up">{idea.target || "—"}</div>
          </div>
          <div className="min-w-0">
            <div className="text-2xs text-muted-foreground">Стоп</div>
            <div className="truncate font-medium text-down">{idea.stop || "—"}</div>
          </div>
        </div>
      )}

      <LevelsBar plan={plan} price={tracking?.price} />

      <OutcomeChips idea={idea} tracking={tracking} />

      <div className="flex items-center justify-between gap-2 pt-0.5 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5">
          <Avatar name={idea.trader} />
          <span className="truncate text-foreground/90">{idea.trader ?? "—"}</span>
          <span className="shrink-0">· {relTime(idea.publishedAt ?? idea.createdAt)}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2 tabular-nums">
          {up > 0 && <span className="flex items-center gap-0.5 text-up" title="Одобряю"><ThumbsUp className="h-3 w-3" aria-hidden="true" />{up}</span>}
          {warn > 0 && <span className="flex items-center gap-0.5 text-[hsl(var(--chart-3))]" title="Сомневаюсь"><AlertTriangle className="h-3 w-3" aria-hidden="true" />{warn}</span>}
          {down > 0 && <span className="flex items-center gap-0.5 text-down" title="Против"><ThumbsDown className="h-3 w-3" aria-hidden="true" />{down}</span>}
          {comments > 0 && <span className="flex items-center gap-0.5" title="Комментарии"><MessageSquare className="h-3 w-3" aria-hidden="true" />{comments}</span>}
          {unread > 0 && (
            <span className="h-2 w-2 rounded-full bg-primary" title={`Новых уведомлений: ${unread}`}>
              <span className="sr-only">Новое: {unread}</span>
            </span>
          )}
        </span>
      </div>
    </button>
  );
}
