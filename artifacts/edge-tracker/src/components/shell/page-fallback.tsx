/**
 * Route-level loading (the page chunk is still on its way): a skeleton in the shape of the page being opened — the
 * dashboard's panels, the trades table, the analytics KPI row + charts, the journal's day columns, master–detail for
 * the playbook and the academy — so the swap to the real page does not jump. Unknown routes get the generic shape
 * (title, KPI row, one block).
 */
import { useLocation } from "wouter";
import { ChartSkeleton, ListSkeleton, PanelSkeleton, SkeletonBlock, SplitSkeleton, StatGridSkeleton, TableSkeleton } from "@/components/ds";
import { shellI18n } from "@/i18n/ns/shell";

export type PageShape = "dashboard" | "table" | "analytics" | "journal" | "split" | "desk" | "generic";

/** Which skeleton shape a path gets (pure, unit-tested). */
export function pageShapeOf(path: string): PageShape {
  const top = "/" + (path.split(/[?#]/)[0]!.split("/")[1] ?? "");
  if (top === "/") return "dashboard";
  if (top === "/trades") return "table";
  if (["/stats", "/analytics", "/behavior", "/what-if", "/benchmark", "/my-review"].includes(top)) return "analytics";
  if (["/journal", "/day-report", "/weekly-review"].includes(top)) return "journal";
  if (["/playbook", "/academy"].includes(top)) return "split";
  if (["/risk", "/curator", "/scaling"].includes(top)) return "desk";
  return "generic";
}

function TitleSkeleton() {
  return (
    <div className="space-y-2">
      <SkeletonBlock className="h-7 w-48" />
      <SkeletonBlock className="h-4 w-72 max-w-full" />
    </div>
  );
}

function Body({ shape }: { shape: PageShape }) {
  switch (shape) {
    case "dashboard":
      return (
        <>
          <div className="glass-panel flex min-h-[148px] flex-col gap-3 rounded-2xl p-[var(--panel-p)]">
            <SkeletonBlock className="h-4 w-40" />
            <SkeletonBlock className="h-10 w-56" />
            <SkeletonBlock className="h-3 w-2/3" />
          </div>
          <div className="grid grid-cols-1 gap-[var(--grid-gap)] lg:grid-cols-3">
            <ChartSkeleton className="lg:col-span-2" height={220} />
            <div className="glass-panel flex flex-col gap-3 rounded-2xl p-[var(--panel-p)]"><SkeletonBlock className="h-4 w-32" /><ListSkeleton rows={4} /></div>
          </div>
        </>
      );
    case "table":
      return (
        <>
          <SkeletonBlock className="h-11 rounded-2xl" />
          <StatGridSkeleton count={4} />
          <div className="glass-panel overflow-hidden rounded-2xl"><TableSkeleton rows={8} cols={6} /></div>
        </>
      );
    case "analytics":
      return (
        <>
          <SkeletonBlock className="h-11 rounded-2xl" />
          <StatGridSkeleton count={4} />
          <div className="grid grid-cols-1 gap-[var(--grid-gap)] lg:grid-cols-3">
            <ChartSkeleton className="lg:col-span-2" height={260} />
            <ChartSkeleton height={260} kind="bars" />
          </div>
        </>
      );
    case "journal":
      return (
        <>
          <SkeletonBlock className="h-11 rounded-2xl" />
          <div className="grid grid-cols-1 gap-[var(--grid-gap)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <PanelSkeleton height={180} />
            <div className="glass-panel flex flex-col gap-3 rounded-2xl p-[var(--panel-p)]"><SkeletonBlock className="h-4 w-36" /><ListSkeleton rows={4} /></div>
          </div>
        </>
      );
    case "split":
      return <SplitSkeleton side="320px" rows={7} />;
    case "desk":
      return (
        <>
          <StatGridSkeleton count={4} />
          <div className="glass-panel overflow-hidden rounded-2xl"><TableSkeleton rows={8} cols={7} /></div>
        </>
      );
    default:
      return (
        <>
          <StatGridSkeleton count={4} />
          <PanelSkeleton height={256} title={false} />
        </>
      );
  }
}

export function PageFallback() {
  const [location] = useLocation();
  const shape = pageShapeOf(location);
  return (
    <div role="status" aria-busy="true" data-shape={shape}>
      <span className="sr-only">{shellI18n.t("app.pageLoading")}</span>
      {/* One announcement for the page, not one per placeholder block. */}
      <div aria-hidden="true" className="flex flex-col gap-[var(--page-gap,1.25rem)]">
        <TitleSkeleton />
        <Body shape={shape} />
      </div>
    </div>
  );
}
