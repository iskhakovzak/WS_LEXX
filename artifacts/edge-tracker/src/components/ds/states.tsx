/**
 * Loading / error / empty states with one look everywhere.
 *
 *   <ErrorState error={q.error} onRetry={q.refetch} />            // full block with «Повторить»
 *   <ErrorState error={q.error} onRetry={q.refetch} compact />    // one-line, inside lists/tiles
 *   <ErrorState … inset />                                        // inside a Panel (no second glass card)
 *
 *   <QueryState
 *     query={q}                                   // any react-query result (isLoading/isError/error/refetch)
 *     isEmpty={(d) => d.length === 0}
 *     skeleton={<ListSkeleton rows={6} />}
 *     empty={<EmptyState icon={Inbox} title="Пока пусто" action={<Button>Добавить</Button>} />}
 *   >
 *     {(data) => <List items={data} />}
 *   </QueryState>
 *
 * Skeletons keep the final layout's box (no jump when data arrives): StatGridSkeleton, ListSkeleton,
 * TableSkeleton, PanelSkeleton, SkeletonBlock.
 */
import * as React from "react";
import { QueryError } from "@/components/query-error";
import { cn } from "@/lib/utils";
import { commonI18n } from "@/i18n/ns/common";

/* ── Error ─────────────────────────────────────────────────────────────────── */

export function ErrorState({
  error,
  onRetry,
  title,
  message,
  compact = false,
  inset = false,
  retryLabel,
  className,
}: {
  error?: unknown;
  /** Shows «Повторить». Pass react-query's `refetch`. */
  onRetry?: () => unknown;
  title?: string;
  message?: string;
  compact?: boolean;
  /** Render without its own glass card (when already inside a Panel). */
  inset?: boolean;
  /** Retry button text (default «Повторить»). */
  retryLabel?: string;
  className?: string;
}) {
  return (
    <QueryError
      error={error}
      onRetry={onRetry ? () => { void onRetry(); } : undefined}
      title={title}
      message={message}
      compact={compact}
      retryLabel={retryLabel}
      className={cn(inset && !compact && "border-0 bg-transparent bg-none py-8 shadow-none", className)}
    />
  );
}

/* ── Skeletons ─────────────────────────────────────────────────────────────── */

/** Single shimmer block. Give it the final element's size (h-*, w-*). */
export function SkeletonBlock({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("skeleton h-4 w-full", className)} {...rest} />;
}

/** Placeholder for a StatGrid of KPI cards (same min width, same height as StatCard). */
export function StatGridSkeleton({ count = 4, min = "11rem", className }: { count?: number; min?: string; className?: string }) {
  return (
    <div
      role="status"
      aria-label={commonI18n.t("ds.loadingKpis")}
      className={cn("grid gap-[var(--grid-gap)]", className)}
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}, 100%), 1fr))` }}
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="glass-panel flex min-h-[104px] flex-col gap-2 rounded-2xl p-4">
          <SkeletonBlock className="h-3 w-20" />
          <SkeletonBlock className="h-7 w-28" />
          <SkeletonBlock className="mt-auto h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Rows of a list/feed: avatar-ish dot + two lines. */
export function ListSkeleton({ rows = 5, className, dense = false }: { rows?: number; className?: string; dense?: boolean }) {
  return (
    <div role="status" aria-label={commonI18n.t("ds.loadingList")} className={cn("flex flex-col", dense ? "gap-1.5" : "gap-2.5", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={cn("flex items-center gap-3", dense ? "py-1" : "py-1.5")}>
          <SkeletonBlock className="h-8 w-8 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <SkeletonBlock className="h-3.5" style={{ width: `${70 - ((i * 13) % 30)}%` }} />
            {!dense && <SkeletonBlock className="h-3 w-1/3" />}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Table placeholder: header + N rows with `cols` cells, compact density (matches DataTable). */
export function TableSkeleton({ rows = 8, cols = 5, className }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div role="status" aria-label={commonI18n.t("ds.loadingTable")} className={cn("flex flex-col", className)}>
      <div className="flex gap-3 border-b border-[var(--glass-border)] px-3 py-2.5">
        {Array.from({ length: cols }, (_, c) => <SkeletonBlock key={c} className="h-3 flex-1" />)}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-3 border-b border-border/40 px-3 py-[11px] last:border-b-0">
          {Array.from({ length: cols }, (_, c) => (
            <SkeletonBlock key={c} className="h-3.5 flex-1" style={{ opacity: c === 0 ? 1 : 0.7 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Panel-shaped placeholder (title line + body of given height). */
export function PanelSkeleton({ height = 240, title = true, className }: { height?: number | string; title?: boolean; className?: string }) {
  return (
    <div role="status" aria-label={commonI18n.t("states.loading")} className={cn("glass-panel flex flex-col gap-3 rounded-2xl p-[var(--panel-p)]", className)}>
      {title && <SkeletonBlock className="h-4 w-40" />}
      <SkeletonBlock className="w-full rounded-xl" style={{ height }} />
    </div>
  );
}

/**
 * Chart panel placeholder: title + legend line, a plot area with faint gridlines and a bar / line silhouette, an
 * x-axis row — the shape of the coming chart, so nothing jumps when it draws. `bare` = no glass card (inside a Panel).
 */
export function ChartSkeleton({
  height = 280,
  kind = "line",
  title = true,
  bare = false,
  className,
}: { height?: number | string; kind?: "line" | "bars"; title?: boolean; bare?: boolean; className?: string }) {
  const bars = [46, 62, 38, 71, 55, 80, 44, 66, 58, 74, 49, 85, 61, 70];
  return (
    <div
      role="status"
      aria-label={commonI18n.t("ds.loadingChart")}
      className={cn("flex flex-col gap-3", !bare && "glass-panel rounded-2xl p-[var(--panel-p)]", className)}
    >
      {title && (
        <div className="flex items-center justify-between gap-3">
          <SkeletonBlock className="h-4 w-36" />
          <SkeletonBlock className="h-6 w-28 rounded-full" />
        </div>
      )}
      <div className="relative flex-1 overflow-hidden rounded-xl" style={{ height }} aria-hidden="true">
        {/* Gridlines */}
        <div className="absolute inset-0 flex flex-col justify-between py-2">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-px w-full bg-foreground/[0.06]" />)}
        </div>
        {kind === "bars" ? (
          <div className="absolute inset-x-1 bottom-2 top-4 flex items-end gap-[3%]">
            {bars.map((h, i) => <SkeletonBlock key={i} className="w-full rounded-t-md rounded-b-none" style={{ height: `${h}%` }} />)}
          </div>
        ) : (
          <svg className="absolute inset-0 h-full w-full text-foreground/[0.09]" viewBox="0 0 100 40" preserveAspectRatio="none">
            <path d="M0 32 L8 30 L16 31 L24 25 L32 27 L40 20 L48 22 L56 16 L64 18 L72 12 L80 14 L88 8 L100 10 L100 40 L0 40 Z" fill="currentColor" />
          </svg>
        )}
      </div>
      <div className="flex justify-between gap-2" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => <SkeletonBlock key={i} className="h-2.5 w-10" />)}
      </div>
    </div>
  );
}

/**
 * Master–detail placeholder (a list on the left, the opened item on the right): course list + lesson tree, exam list
 * + exam, setup list + setup card. `side` = the list column width (CSS length).
 */
export function SplitSkeleton({ side = "340px", rows = 6, detailHeight = 384, className }: { side?: string; rows?: number; detailHeight?: number; className?: string }) {
  return (
    <div role="status" aria-label={commonI18n.t("states.loading")} className={cn("grid gap-[var(--grid-gap)] lg:grid-cols-[var(--split-side)_minmax(0,1fr)]", className)} style={{ "--split-side": side } as React.CSSProperties}>
      <div className="glass-panel flex flex-col gap-1 rounded-2xl p-2">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl px-2 py-2.5">
            <SkeletonBlock className="h-8 w-8 shrink-0 rounded-lg" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <SkeletonBlock className="h-3.5" style={{ width: `${78 - ((i * 17) % 34)}%` }} />
              <SkeletonBlock className="h-2.5 w-1/3" />
            </div>
          </div>
        ))}
      </div>
      <div className="glass-panel flex flex-col gap-3 rounded-2xl p-[var(--panel-p)]" style={{ minHeight: detailHeight }}>
        <SkeletonBlock className="h-5 w-1/2" />
        <SkeletonBlock className="h-3.5 w-3/4" />
        <div className="mt-2 flex flex-col gap-2.5">
          {Array.from({ length: 5 }, (_, i) => <SkeletonBlock key={i} className="h-10 rounded-xl" style={{ opacity: 1 - i * 0.12 }} />)}
        </div>
      </div>
    </div>
  );
}

/* ── Query wrapper ─────────────────────────────────────────────────────────── */

type QueryLike<T> = {
  data: T | undefined;
  isLoading?: boolean;
  isPending?: boolean;
  isError?: boolean;
  error?: unknown;
  refetch?: () => unknown;
};

/**
 * Renders skeleton → error (with «Повторить») → empty → content for a react-query result.
 * Keeps previous data visible while refetching (no flashing back to the skeleton).
 */
export function QueryState<T>({
  query,
  children,
  skeleton,
  empty,
  isEmpty,
  errorCompact = false,
  errorInset = false,
  errorTitle,
}: {
  query: QueryLike<T>;
  children: (data: T) => React.ReactNode;
  skeleton?: React.ReactNode;
  empty?: React.ReactNode;
  isEmpty?: (data: T) => boolean;
  errorCompact?: boolean;
  errorInset?: boolean;
  errorTitle?: string;
}) {
  const { data } = query;
  if (data === undefined) {
    if (query.isError) {
      return <ErrorState error={query.error} onRetry={query.refetch} compact={errorCompact} inset={errorInset} title={errorTitle} />;
    }
    return <>{skeleton ?? <ListSkeleton rows={4} />}</>;
  }
  if (isEmpty?.(data) && empty) return <>{empty}</>;
  return <>{children(data)}</>;
}
