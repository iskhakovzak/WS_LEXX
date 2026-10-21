/** Chart placeholders: the loading skeleton (toolbar + chart box) and the one-line notice (no candles / failed load). */
import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { commonI18n } from "@/i18n/ns/common";

export function ChartLoading({ workspace, height, label, className }: { workspace: boolean; height: number; label: string; className?: string }) {
  return (
    <div className={cn("flex w-full min-w-0 flex-col gap-2", workspace && "h-full min-h-0", className)} aria-busy="true">
      <Skeleton className="h-8 w-full max-w-[34rem] rounded-full" />
      <Skeleton className={cn("rounded-2xl", workspace && "min-h-[280px] flex-1")} style={workspace ? undefined : { height }} />
      <span className="sr-only" role="status">{label}</span>
    </div>
  );
}

/** `onRetry` only for a failed request (network / 5xx); «no candles» / weekend / future cannot be retried. */
export function ChartNotice({ text, onRetry, retrying = false, className }: { text: string; onRetry?: () => void; retrying?: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2 rounded-2xl bg-[var(--glass-bg)] px-4 py-6 text-sm text-muted-foreground", className)} role="status">
      <AlertTriangle className="h-4 w-4 shrink-0 text-[hsl(var(--chart-3))]" aria-hidden="true" /> <span className="min-w-0 flex-1">{text}</span>
      {onRetry && (
        <Button variant="ghost" size="sm" onClick={onRetry} disabled={retrying}>
          <RefreshCw className={cn(retrying && "animate-spin motion-reduce:animate-none")} aria-hidden="true" /> {commonI18n.t("actions.retry")}
        </Button>
      )}
    </div>
  );
}
