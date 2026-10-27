/**
 * Building blocks of an insight tile: the glass shell with its label, the huge numeral (blur-in reveal), the
 * caption, the one-sentence verdict (with `*accent*` and inline nodes), the confidence badge, the trend chip, the action
 * chips and the hover / focus detail that shares one grid cell with the chart (no layout shift).
 */
import * as React from "react";
import { useLocation } from "wouter";
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronRight, Info, type LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBeRange } from "@/components/ds/money";
import { classifyPnl, type PnlClass } from "@/lib/appearance/be-range";
import { fmtRate, fmtUsd } from "@/lib/format";
import type { Confidence, Interval, Trend } from "@/lib/stats-lite";
import { rich } from "@/i18n/rich";
import { cn } from "@/lib/utils";
import { insightTilesI18n } from "@/i18n/ns/insightTiles";
import type { Claim } from "./insights";
import "./insight-tiles.css";

export const usd = (v: number | null | undefined) => fmtUsd(v, { signed: true, decimals: "auto" });
export const usdAbs = (v: number | null | undefined) => fmtUsd(v == null ? v : Math.abs(v), { decimals: "auto" });
/** Percentage points of a share difference: «17 п.п.». */
export const pp = (share: number | null | undefined) => insightTilesI18n.t("pp", { n: share == null ? "—" : Math.abs(Math.round(share * 1000) / 10) });

const TONE: Record<PnlClass, "up" | "down" | "be" | undefined> = { win: "up", loss: "down", be: "be", flat: undefined, none: undefined };

/** Money tone of a dollar value under the «Вид» break-even range («up» / «down» / «be» / none). */
export function useTone() {
  const range = useBeRange();
  return React.useCallback((v: number | null | undefined) => TONE[classifyPnl(v, range)], [range]);
}

const TEXT = { up: "text-up", down: "text-down", be: "text-be" } as const;
export function toneText(tone: "up" | "down" | "be" | undefined): string {
  return tone ? TEXT[tone] : "text-foreground";
}

/* ─────────────────────────── text ─────────────────────────── */

/** A translated sentence with `*accent*` words (semibold) and {slot} nodes. */
export function Phrase({ text, nodes = {} }: { text: string; nodes?: Record<string, React.ReactNode> }) {
  const parts = text.split(/(\*[^*]+\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("*") && p.endsWith("*") && p.length > 2 ? (
          <em key={i} className="ins-accent">{rich(p.slice(1, -1), nodes)}</em>
        ) : (
          <React.Fragment key={i}>{rich(p, nodes)}</React.Fragment>
        ),
      )}
    </>
  );
}

export function Verdict({ text, nodes, large, className }: { text: string; nodes?: Record<string, React.ReactNode>; large?: boolean; className?: string }) {
  return (
    <p className={cn("ins-verdict", large && "ins-verdict-lg", className)}>
      <Phrase text={text} nodes={nodes} />
    </p>
  );
}

/** A number inside a verdict: bold, tabular, in its money colour. */
export function Num({ children, tone }: { children: React.ReactNode; tone?: "up" | "down" | "be" }) {
  return <b className={cn("font-semibold tabular-nums", tone && toneText(tone))}>{children}</b>;
}

/* ─────────────────────────── numerals ─────────────────────────── */

export function Huge({ children, tone, size = "lg", label }: { children: React.ReactNode; tone?: "up" | "down" | "be"; size?: "xl" | "lg" | "md"; label?: string }) {
  // The reveal sits on the wrapper: a tween / flash inside keeps its own animation.
  return (
    <span className="reveal inline-block" aria-label={label} role={label ? "img" : undefined}>
      <span className={cn("ins-huge", `ins-huge-${size}`)} data-tone={tone} aria-hidden={label ? true : undefined}>
        {children}
      </span>
    </span>
  );
}

export function Caption({ text, nodes, xl, className }: { text: string; nodes?: Record<string, React.ReactNode>; xl?: boolean; className?: string }) {
  return (
    <span className={cn("ins-caption", xl && "ins-caption-xl", className)}>
      <Phrase text={text} nodes={nodes} />
    </span>
  );
}

/* ─────────────────────────── badges ─────────────────────────── */

const CONF_DOT: Record<Confidence, string> = { solid: "bg-foreground", hypothesis: "bg-foreground/45", low: "border border-foreground/40" };

/** «надёжно · 80%: −$310 … −$62» / «пока гипотеза» / «мало данных: 6 из 10». */
export function ConfidenceBadge({ claim, fmt, have, need }: { claim: Claim; fmt: (v: number) => string; have?: number; need?: number }) {
  const { t } = insightTilesI18n.useT();
  const { confidence, ci } = claim;
  const text = confidence === "low" && have != null && need != null ? t("lowData", { have, need }) : t(`confidence.${confidence}`);
  const tip = ci ? intervalText(ci, fmt) : null;
  const badge = (
    <span className="inline-flex min-h-6 items-center gap-1.5 rounded-full border border-[var(--glass-border)] px-2 text-2xs font-medium text-muted-foreground tabular-nums">
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", CONF_DOT[confidence])} aria-hidden="true" />
      {text}
      {ci && confidence !== "low" && <span className="ins-ci hidden text-muted-foreground/80 sm:inline">· {tip}</span>}
    </span>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{badge}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs leading-snug">
        {tip && <div className="mb-1 font-medium tabular-nums">{tip}</div>}
        {t("confidence.explain", { days: ci?.days ?? 0, level: fmtRate(ci?.level ?? 0.8) })}
      </TooltipContent>
    </Tooltip>
  );
}

function intervalText(ci: Interval, fmt: (v: number) => string): string {
  return insightTilesI18n.t("confidence.interval", { level: fmtRate(ci.level), lo: fmt(ci.lo), hi: fmt(ci.hi) });
}

/** ↗ / ↘ and the change versus the previous equal period, coloured by better / worse. */
export function TrendChip({ trend, fmt }: { trend: Trend | null; fmt: (delta: number) => string }) {
  const { t } = insightTilesI18n.useT();
  if (!trend) return null;
  const Icon = trend.dir === "flat" ? ArrowRight : trend.delta > 0 ? ArrowUpRight : ArrowDownRight;
  const delta = fmt(trend.delta);
  const label = trend.dir === "flat" ? t("trend.flat") : t(`trend.${trend.dir}`, { delta });
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center gap-1 rounded-full px-2 text-2xs font-medium tabular-nums",
        trend.dir === "better" ? "bg-up/10 text-up" : trend.dir === "worse" ? "bg-down/10 text-down" : "bg-foreground/5 text-muted-foreground",
      )}
      title={label}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">{trend.dir === "flat" ? t("trend.flat") : t("trend.short", { delta })}</span>
    </span>
  );
}

/* ─────────────────────────── actions ─────────────────────────── */

/** A small action that does something real: a link (client-side) or a handler. */
export function ActionChip({ icon: Icon, label, href, onClick, primary }: { icon: LucideIcon; label: string; href?: string; onClick?: () => void; primary?: boolean }) {
  const [, navigate] = useLocation();
  const cls = cn(
    // Two lines before clipping (owner: «в кнопках текст не помещается»): «Проверить: не больше 3 сделок в день» was
    // cut to «Проверить: не больше 3…» in a 1440 px dashboard tile. A wrapped chip becomes a capsule (18px radius).
    "inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-[1.125rem] px-3 py-1 text-left text-xs font-medium leading-ui transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    primary ? "bg-foreground text-background hover:bg-foreground/90" : "border border-[var(--glass-border)] text-foreground hover:bg-[var(--glass-hover-bg)]",
  );
  const body = (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="line-clamp-2 min-w-0 text-balance">{label}</span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />
    </>
  );
  if (href) {
    return (
      <a
        href={href}
        className={cls}
        title={label}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          navigate(href);
        }}
      >
        {body}
      </a>
    );
  }
  return <button type="button" className={cls} title={label} onClick={onClick}>{body}</button>;
}

export function Actions({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

/* ─────────────────────────── the shell ─────────────────────────── */

export type TileSize = "hero" | "wide" | "third" | "half" | "quarter";
/**
 * The dashboard's content layout of a tile at its packed width (components/dashboard layout model): `s` compact = the
 * numeral + the verdict (+ the trend), `m` medium = + the chart and one action row, `l` large = full detail, the chart
 * and the detail side by side. Unset (/stats bento): the original tile.
 */
export type TileVariant = "s" | "m" | "l";

type TileProps = {
  id: string;
  size: TileSize;
  /** Dashboard content layout (see TileVariant). */
  variant?: TileVariant;
  /** Phones: the verdict above the numeral (default) — off when the verdict reads only after the numeral. */
  phoneVerdictFirst?: boolean;
  label: string;
  extra?: React.ReactNode;
  /** The confidence badge: sits with the trend under the body, never in the header row. */
  badge?: React.ReactNode;
  hero?: React.ReactNode;
  verdict?: React.ReactNode;
  chart?: React.ReactNode;
  detail?: React.ReactNode;
  /** A small visual the compact variant keeps (the streak's last capsules). */
  mini?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
};

/**
 * The tile: glass shell, mono label (+ right-side extras), hero block, verdict, the body where the chart and the detail
 * share one cell, then badges and actions. The detail shows while the pointer is over the hero, while the «Подробнее»
 * button is pressed (touch / keyboard) — never only on hover. The large dashboard variant shows both at once.
 */
export function Tile(props: TileProps) {
  if (props.variant === "s") return <CompactTile {...props} />;
  if (props.variant === "l") return <LargeTile {...props} />;
  return <FullTile {...props} />;
}

function TileHead({ id, label, extra, children }: { id: string; label: string; extra?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-6 flex-wrap items-center justify-between gap-2">
      <h3 id={`ins-${id}-label`} className="ins-label">{label}</h3>
      <div className="flex flex-wrap items-center gap-1.5">
        {extra}
        {children}
      </div>
    </div>
  );
}

/** The original tile (/stats) and the dashboard's medium variant. */
function FullTile({ id, size, variant, label, extra, badge, hero, verdict, chart, detail, meta, actions, className, phoneVerdictFirst = true }: TileProps) {
  const { t } = insightTilesI18n.useT();
  const [open, setOpen] = React.useState(false);
  const [peek, setPeek] = React.useState(false);
  const showDetail = !!detail && (open || peek);
  const detailId = `ins-${id}-detail`;
  // The dashboard's medium tile reads top-down on every screen (no phone reordering).
  const verdictFirst = phoneVerdictFirst && !variant;
  return (
    <section data-size={size} data-variant={variant} aria-labelledby={`ins-${id}-label`} className={cn("ins-tile glass-panel", className)}>
      <TileHead id={id} label={label} extra={extra}>
        {detail && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-2xs font-medium text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="ins-more-text">{open ? t("less") : t("more")}</span>
          </button>
        )}
      </TileHead>
      {/* Phones: the verdict comes first (it is the answer), the numeral after it. */}
      {verdict && verdictFirst && <div className="sm:hidden">{verdict}</div>}
      {hero && (
        <div
          className="min-w-0"
          onPointerEnter={(e) => { if (e.pointerType === "mouse") setPeek(true); }}
          onPointerLeave={() => setPeek(false)}
        >
          {hero}
        </div>
      )}
      {verdict && <div className={verdictFirst ? "hidden sm:block" : undefined}>{verdict}</div>}
      {(chart || detail) && (
        <div className="ins-body" data-detail={showDetail}>
          {chart && <div className="ins-layer ins-chart flex flex-col justify-end" aria-hidden={showDetail || undefined}>{chart}</div>}
          {detail && (
            <div id={detailId} className="ins-layer ins-detail" aria-hidden={!showDetail || undefined}>
              {detail}
            </div>
          )}
        </div>
      )}
      {(badge || meta) && <div className="flex flex-wrap items-center gap-1.5">{badge}{meta}</div>}
      {actions}
    </section>
  );
}

/** Compact: the numeral and the verdict (+ the trend and a mini visual); everything else is one click away on /stats. */
function CompactTile({ id, size, label, hero, verdict, mini, meta, className }: TileProps) {
  return (
    <section data-size={size} data-variant="s" aria-labelledby={`ins-${id}-label`} className={cn("ins-tile glass-panel", className)}>
      <TileHead id={id} label={label} />
      {hero && <div className="min-w-0">{hero}</div>}
      {verdict && <div className="ins-compact-verdict">{verdict}</div>}
      {mini && <div className="mt-auto min-w-0">{mini}</div>}
      {meta && <div className={cn("flex flex-wrap items-center gap-1.5", !mini && "mt-auto")}>{meta}</div>}
    </section>
  );
}

/** Large: the answer on the left (numeral, verdict, badges, actions), the chart over its detail on the right. */
function LargeTile({ id, size, label, extra, badge, hero, verdict, chart, detail, meta, actions, className }: TileProps) {
  return (
    <section data-size={size} data-variant="l" aria-labelledby={`ins-${id}-label`} className={cn("ins-tile glass-panel", className)}>
      <TileHead id={id} label={label} extra={extra} />
      <div className="ins-large">
        <div className="ins-large-main">
          {hero && <div className="min-w-0">{hero}</div>}
          {verdict}
          {(badge || meta) && <div className="flex flex-wrap items-center gap-1.5">{badge}{meta}</div>}
          {actions && <div className="mt-auto">{actions}</div>}
        </div>
        {(chart || detail) && (
          <div className="ins-large-side">
            {chart && <div className="min-w-0">{chart}</div>}
            {detail && <div className="ins-large-detail">{detail}</div>}
          </div>
        )}
      </div>
    </section>
  );
}

/** Label / value pairs of the detail layer. */
export function DetailGrid({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-3 gap-x-3 gap-y-2 self-end text-sm">
      {items.map((it, i) => (
        // Labels can repeat («Ср. прибыль» after a loss and after a win): the position keeps keys unique.
        <div key={`${i}:${it.label}`} className="min-w-0">
          <dt className="truncate text-2xs text-muted-foreground" title={it.label}>{it.label}</dt>
          <dd className="truncate font-semibold tabular-nums">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** «Мало данных» in place of a verdict, with the count. */
export function LowData({ have, need }: { have: number; need: number }) {
  const { t } = insightTilesI18n.useT();
  return (
    <div className="flex flex-col gap-1">
      <p className="ins-verdict text-muted-foreground">{t("lowDataTitle")}</p>
      <p className="text-xs text-muted-foreground tabular-nums">{t("lowData", { have, need })}</p>
    </div>
  );
}

/* ─────────────────────────── tiny charts ─────────────────────────── */

/** Bars inside a sentence (1em tall): the marked bar solid, the rest faint. */
export function InlineBars({ values, mark, tone }: { values: number[]; mark: number; tone: (v: number) => "up" | "down" | "be" | undefined }) {
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));
  const w = 5, gap = 3, h = 16;
  return (
    <svg className="ins-inline" viewBox={`0 0 ${values.length * (w + gap) - gap} ${h}`} aria-hidden="true">
      <line x1={0} x2={values.length * (w + gap)} y1={h / 2} y2={h / 2} stroke="currentColor" strokeOpacity={0.25} strokeWidth={0.75} />
      {values.map((v, i) => {
        const bh = Math.max(1.5, (Math.abs(v) / max) * (h / 2));
        const tn = tone(v);
        const fill = tn === "up" ? "hsl(var(--up))" : tn === "down" ? "hsl(var(--down))" : tn === "be" ? "hsl(var(--be))" : "currentColor";
        return <rect key={i} x={i * (w + gap)} y={v >= 0 ? h / 2 - bh : h / 2} width={w} height={bh} rx={1.5} fill={fill} fillOpacity={i === mark ? 1 : 0.35} />;
      })}
    </svg>
  );
}

/** Line sparkline of a cumulative series (today's net). */
export function Spark({ series, tone, label, className }: { series: number[]; tone: "up" | "down" | "be" | undefined; label: string; className?: string }) {
  const gid = `isp${React.useId().replace(/:/g, "")}`;
  const w = 160, h = 44;
  if (series.length < 2) return null;
  const min = Math.min(0, ...series), max = Math.max(0, ...series);
  const span = max - min || 1;
  const x = (i: number) => (i / (series.length - 1)) * w;
  const y = (v: number) => h - 2 - ((v - min) / span) * (h - 4);
  // Straight segments: only the real points of the day, no curve between them.
  const d = series.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const color = tone === "up" ? "hsl(var(--up))" : tone === "down" ? "hsl(var(--down))" : tone === "be" ? "hsl(var(--be))" : "hsl(var(--foreground))";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-11 w-40", className)} role="img" aria-label={label} preserveAspectRatio="none">
      <line x1={0} x2={w} y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity={0.2} strokeDasharray="2 3" strokeWidth={1} />
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.26} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <path d={`${d} L${w},${y(0)} L0,${y(0)} Z`} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(series.length - 1)} cy={y(series[series.length - 1])} r={3} fill={color} />
    </svg>
  );
}

/** Compact hold «45с», «5м», «1ч 20м» in the UI language. */
export function fmtHold(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const s = Math.max(0, Math.round(sec));
  const t = insightTilesI18n.t;
  if (s < 60) return t("hold.s", { s });
  if (s < 3600) {
    const m = Math.floor(s / 60), r = s % 60;
    return m < 10 && r ? t("hold.ms", { m, s: r }) : t("hold.m", { m });
  }
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return m ? t("hold.hm", { h, m }) : t("hold.h", { h });
}
