/**
 * The optional AI extra of the quote card: today's AI pair (trading + psychology) generated once a day for the whole
 * team (GET /api/daily-quote/today; staff can regenerate it — dailyfeed.manage). Not the default any more: the card
 * shows the curated library; this panel opens only on «Сгенерировать AI-цитату» and says it has no verified source.
 */
import { ArrowLeft, Brain, RefreshCw, TrendingUp } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetTodayDailyQuoteQueryKey, useGetTodayDailyQuote, useRegenerateDailyQuote } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import type { QuoteLang } from "@/lib/quotes/types";
import { quotesI18n } from "@/i18n/ns/quotes";
import { marketWidgetsI18n } from "@/i18n/ns/marketWidgets";

type AiRow = {
  tradingRu: string; tradingUz: string; tradingUk: string; tradingEn?: string | null; tradingAuthor?: string | null;
  psychologyRu: string; psychologyUz: string; psychologyUk: string; psychologyEn?: string | null; psychologyAuthor?: string | null;
};

function pick(q: AiRow, cat: "trading" | "psychology", lang: QuoteLang): string {
  const by = cat === "trading"
    ? { ru: q.tradingRu, uz: q.tradingUz, uk: q.tradingUk, en: q.tradingEn || q.tradingRu }
    : { ru: q.psychologyRu, uz: q.psychologyUz, uk: q.psychologyUk, en: q.psychologyEn || q.psychologyRu };
  return by[lang];
}

export function AiQuotePanel({ lang, staff, onBack }: { lang: QuoteLang; staff: boolean; onBack: () => void }) {
  const { t } = quotesI18n.useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useGetTodayDailyQuote({ query: { staleTime: 60_000, retry: 1 } as never });
  const regenerate = useRegenerateDailyQuote({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getGetTodayDailyQuoteQueryKey() });
        toast({ title: marketWidgetsI18n.t("quote.updated"), description: marketWidgetsI18n.t("quote.updatedText") });
      },
      onError: (e: { message?: string }) => {
        toast({ title: marketWidgetsI18n.t("quote.updateFailed"), description: e?.message || marketWidgetsI18n.t("quote.aiUnavailable"), variant: "destructive" });
      },
    },
  } as never);

  const row = data as AiRow | undefined;
  return (
    <div className="space-y-3" data-testid="quote-ai-panel">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-foreground">{t("ai.title")}</p>
        <div className="flex items-center gap-1">
          {staff && (
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" disabled={regenerate.isPending} onClick={() => regenerate.mutate()}>
              <RefreshCw className={regenerate.isPending ? "h-3 w-3 motion-safe:animate-spin" : "h-3 w-3"} aria-hidden="true" />
              {marketWidgetsI18n.t("quote.regenerate")}
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={onBack}>
            <ArrowLeft className="h-3 w-3" aria-hidden="true" /> {t("ai.back")}
          </Button>
        </div>
      </div>
      {isLoading ? (
        <div className="space-y-2" aria-busy="true"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /></div>
      ) : isError || !row ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          {t("ai.failed")}
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void refetch()}>
            <RefreshCw className="h-3 w-3" aria-hidden="true" /> {t("ai.retry")}
          </Button>
        </p>
      ) : (
        <>
          {(["trading", "psychology"] as const).map((cat) => {
            const Icon = cat === "trading" ? TrendingUp : Brain;
            const author = cat === "trading" ? row.tradingAuthor : row.psychologyAuthor;
            return (
              <figure key={cat} className="min-w-0">
                <figcaption className="mb-1 inline-flex items-center gap-1 text-2xs font-medium text-muted-foreground">
                  <Icon className="h-3 w-3" aria-hidden="true" />
                  {marketWidgetsI18n.t(cat === "trading" ? "quote.trading" : "quote.psychology")}
                  {author ? ` · ${author}` : ""}
                </figcaption>
                <blockquote className="text-sm leading-relaxed text-foreground" lang={lang}>{pick(row, cat, lang)}</blockquote>
              </figure>
            );
          })}
          <p className="text-2xs italic text-muted-foreground">{t("ai.hint")}</p>
        </>
      )}
    </div>
  );
}
