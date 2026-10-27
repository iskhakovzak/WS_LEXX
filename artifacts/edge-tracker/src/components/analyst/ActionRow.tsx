/**
 * Small building blocks shared by «Сегодня до открытия», the actions table and the ticker sheet.
 */
import { useLocation } from "wouter";
import {
  ArrowRight, BookmarkCheck, BookmarkPlus, Briefcase, Building2, CalendarPlus, CalendarCheck, ExternalLink, Hash, History,
  Lightbulb, Loader2, Repeat,
} from "lucide-react";
import { Delta, Pill, RowActions as DsRowActions } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import type { ReactionAgg } from "./api";
import { REACTION_MIN_N } from "./rows";
import { KIND_META, num, ptChangePct, upsidePct, type FeedAction, type OpenPosition } from "./lib";
import { fmtPct, fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { analystI18n } from "@/i18n/ns/analyst";
import { rich } from "@/i18n/rich";

export function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-primary/25 px-0.5 text-foreground">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

/** Horizon code → lower-case label in the UI language (common trading words, read at access time). */
export const HORIZON_LABEL = {} as Record<OpenPosition["horizon"], string>;
for (const k of ["intraday", "overnight", "swing"] as const) {
  Object.defineProperty(HORIZON_LABEL, k, { get: () => commonI18n.t(`trading.${k}`).toLowerCase(), enumerable: true });
}

export function KindPill({ kind, className }: { kind: FeedAction["action"]; className?: string }) {
  const m = KIND_META[kind] ?? KIND_META.other;
  return (
    <Pill tone={m.tone} dot={m.tone !== "neutral"} className={cn("text-2xs", className)}>
      {m.short}
    </Pill>
  );
}

export function GradeChange({ from, to, className }: { from: string | null; to: string | null; className?: string }) {
  if (!from && !to) return null;
  const changed = from && to && from !== to;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1 text-xs", className)} title={changed ? `${from} → ${to}` : (to ?? from ?? "")}>
      {changed ? (
        <>
          <span className="truncate text-muted-foreground">{from}</span>
          <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate font-medium text-foreground">{to}</span>
        </>
      ) : (
        <span className="truncate text-foreground">{to ?? from}</span>
      )}
    </span>
  );
}

/** Target change. Renders nothing when the action has no target (no «PT —» noise). */
export function TargetChange({ action, price, showUpside = true }: { action: FeedAction; price?: number | null; showUpside?: boolean }) {
  const to = num(action.priceTarget);
  const from = num(action.priceTargetFrom);
  const chg = ptChangePct(action);
  const up = showUpside ? upsidePct(action, price) : null;
  if (to == null && from == null) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs tabular-nums">
      {from != null && to != null && from !== to ? (
        <>
          <span className="text-muted-foreground">{fmtUsd(from, { decimals: "trim" })}</span>
          <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium text-foreground">{fmtUsd(to, { decimals: "trim" })}</span>
        </>
      ) : (
        <span className="font-medium text-foreground">{fmtUsd(to ?? from, { decimals: "trim" })}</span>
      )}
      {chg != null && chg !== 0 && <Delta value={chg} suffix="%" precision={0} showIcon={false} bare />}
      {up != null && (
        <span className="text-muted-foreground" title={analystI18n.t("row.upsideTitle")}>
          {rich(analystI18n.t("row.upside", { value: "{value}" }), { value: <span className={cn("font-medium", up >= 0 ? "text-up" : "text-down")}>{fmtPct(up, 0)}</span> })}
        </span>
      )}
    </span>
  );
}

/** Icons for «позиция команды», «в вотчлисте», «я торговал». Each has a text label for screen readers. */
export function Marks({ held, watched, traded, className }: { held: OpenPosition[]; watched: boolean; traded: number; className?: string }) {
  const { t } = analystI18n.useT();
  if (!held.length && !watched && !traded) return null;
  const carry = held.find((h) => h.horizon !== "intraday");
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1", className)}>
      {held.length > 0 && (
        <span title={carry ? t("row.heldTitleHz", { horizon: HORIZON_LABEL[carry.horizon] }) : t("row.heldTitle")} className="inline-flex text-warn">
          <Briefcase className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">{t("row.heldSr")}</span>
        </span>
      )}
      {watched && (
        <span title={t("row.watchTitle")} className="inline-flex text-primary">
          <BookmarkCheck className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">{t("row.watchSr")}</span>
        </span>
      )}
      {traded > 0 && (
        <span title={t("row.tradedTitle", { count: traded })} className="inline-flex items-center gap-0.5 text-2xs font-medium text-muted-foreground">
          <Repeat className="h-3 w-3" aria-hidden="true" />
          {traded}
          <span className="sr-only">{t("row.tradedSr")}</span>
        </span>
      )}
    </span>
  );
}

/** Historical average reaction: «+2.4% · 6» (day move, number of events). */
export function ReactionChip({ agg, compact = false }: { agg: ReactionAgg | null; compact?: boolean }) {
  if (!agg || agg.n < REACTION_MIN_N || agg.avgDay == null) return <span className="text-xs text-muted-foreground">—</span>;
  const hit = agg.hitRate != null ? Math.round(agg.hitRate * 100) : null;
  const title = analystI18n.t("row.reactionTitle", { day: fmtPct(agg.avgDay, 1), gap: fmtPct(agg.avgGap, 1), hit: hit ?? "—", count: agg.n });
  return (
    <span className="inline-flex flex-col items-end leading-tight" title={title}>
      <Delta value={agg.avgDay} suffix="%" bare showIcon={false} />
      {!compact && (
        <span className="text-2xs tabular-nums text-muted-foreground">
          {hit != null ? `${hit}% · ` : ""}n={agg.n}
        </span>
      )}
    </span>
  );
}

export type RowActionsProps = {
  action: FeedAction;
  watched: boolean;
  inPlan: boolean;
  addingWatch: boolean;
  addingPlan: boolean;
  canEdit: boolean;
  onAddWatch: () => void;
  onAddPlan: () => void;
  onOpen?: () => void;
  onFilterFirm?: () => void;
  onFilterTicker?: () => void;
  /** Keep the actions visible (the keyboard-focused table row). */
  forceShow?: boolean;
  className?: string;
};

/**
 * «В план» (the session is what this screen prepares for) + «…» (watchlist, idea, history, «только …», source) —
 * ds RowActions: shown on row hover / focus, always on touch. «В плане ✓» stays visible outside it; «в вотчлисте» is in
 * Marks.
 */
export function RowActions({
  action: a, watched, inPlan, addingWatch, addingPlan, canEdit, onAddWatch, onAddPlan, onOpen, onFilterFirm, onFilterTicker, forceShow, className,
}: RowActionsProps) {
  const { t } = analystI18n.useT();
  const [, navigate] = useLocation();
  return (
    <div className={cn("flex shrink-0 items-center justify-end gap-0.5", className)} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {inPlan && (
        <span title={t("row.inPlanTitle")} className="inline-flex text-primary">
          <CalendarCheck className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{t("row.inPlanAria", { ticker: a.ticker })}</span>
        </span>
      )}
      <DsRowActions
        className={cn(forceShow && "opacity-100")}
        menuLabel={t("row.moreAria", { ticker: a.ticker, firm: a.firm })}
        more={[
          {
            label: addingWatch ? commonI18n.t("states.saving") : watched ? t("row.inWatchTitle") : t("row.addWatchTitle"),
            icon: watched ? BookmarkCheck : BookmarkPlus,
            disabled: !canEdit || watched || addingWatch,
            onSelect: onAddWatch,
          },
          { label: t("row.idea"), icon: Lightbulb, onSelect: () => navigate(links.newIdea(a.ticker)) },
          onOpen && { label: t("row.history", { ticker: a.ticker }), icon: History, onSelect: onOpen },
          onFilterTicker && { label: t("row.only", { value: a.ticker }), icon: Hash, onSelect: onFilterTicker },
          onFilterFirm && { label: t("row.only", { value: a.firm }), icon: Building2, onSelect: onFilterFirm },
          a.sourceUrl ? { label: t("row.source", { source: a.source }), icon: ExternalLink, onSelect: () => { window.open(a.sourceUrl!, "_blank", "noopener,noreferrer"); } } : null,
        ]}
      >
        {!inPlan && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onAddPlan}
            disabled={!canEdit || addingPlan}
            aria-label={t("row.addPlanAria", { ticker: a.ticker })}
            title={!canEdit ? t("row.noRights") : t("row.addPlanTitle")}
          >
            {addingPlan ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <CalendarPlus aria-hidden="true" />}
          </Button>
        )}
      </DsRowActions>
    </div>
  );
}
