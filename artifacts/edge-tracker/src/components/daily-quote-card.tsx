import React, { useEffect, useRef, useState } from "react";
import { Quote, RefreshCw, Brain, TrendingUp, Copy, Check, History } from "lucide-react";
import { useGetTodayDailyQuote, useRegenerateDailyQuote, getGetTodayDailyQuoteQueryKey } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/ds";
import { BASE } from "@/lib/api";
import { cn } from "@/lib/utils";
import { WidgetShell, IconAction, WidgetError, useStoredState } from "@/components/widgets/widget-kit";

type Lang = "ru" | "uz" | "uk" | "en";
type Cat = "trading" | "psychology";
const LANGS = ["ru", "uz", "uk", "en"] as const;
const CATS = ["trading", "psychology"] as const;

const LANG_LABELS: Record<Lang, { short: string; full: string }> = {
  ru: { short: "RU", full: "Русский" },
  uz: { short: "UZ", full: "Oʻzbek" },
  uk: { short: "UK", full: "Українська" },
  en: { short: "EN", full: "English" },
};

type QuoteRow = {
  id?: number;
  date: string;
  tradingRu: string;
  tradingUz: string;
  tradingUk: string;
  tradingEn?: string | null;
  tradingAuthor?: string | null;
  psychologyRu: string;
  psychologyUz: string;
  psychologyUk: string;
  psychologyEn?: string | null;
  psychologyAuthor?: string | null;
  source?: string | null;
};

function pick(q: QuoteRow, cat: Cat, lang: Lang): string {
  if (cat === "trading") {
    if (lang === "ru") return q.tradingRu;
    if (lang === "uz") return q.tradingUz;
    if (lang === "uk") return q.tradingUk;
    return q.tradingEn || q.tradingRu;
  }
  if (lang === "ru") return q.psychologyRu;
  if (lang === "uz") return q.psychologyUz;
  if (lang === "uk") return q.psychologyUk;
  return q.psychologyEn || q.psychologyRu;
}

function fmtDay(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

/** Last 14 days of quotes in the current language/category. */
function ArchivePopover({ lang, cat }: { lang: Lang; cat: Cat }) {
  const [open, setOpen] = useState(false);
  const recent = useQuery<QuoteRow[]>({
    queryKey: ["daily-quote-recent"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/daily-quote/recent`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    enabled: open,
    staleTime: 10 * 60_000,
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconAction icon={History} label="Архив цитат" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="border-b border-border/60 px-4 py-2.5 text-sm font-semibold">
          Архив · {cat === "trading" ? "Трейдинг" : "Психология"}
        </div>
        <div className="max-h-[min(30rem,65dvh)] overflow-y-auto overscroll-contain px-4 py-2">
          {recent.isLoading ? (
            <div className="space-y-2 py-1" aria-busy="true">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
            </div>
          ) : recent.isError ? (
            <WidgetError message="Архив недоступен" onRetry={() => recent.refetch()} />
          ) : (recent.data ?? []).length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Архив пуст.</p>
          ) : (
            <ul className="divide-y divide-border/40">
              {(recent.data ?? []).map((q) => {
                const author = cat === "trading" ? q.tradingAuthor : q.psychologyAuthor;
                return (
                  <li key={q.date} className="py-2">
                    <div className="mb-0.5 text-2xs tabular-nums text-muted-foreground">{fmtDay(q.date)}{author ? ` · ${author}` : ""}</div>
                    <p className="text-sm leading-snug text-foreground/90" lang={lang}>{pick(q, cat, lang)}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function DailyQuoteCard() {
  const { isCurator } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [lang, setLang] = useStoredState<Lang>("daily_quote_lang", "ru", LANGS);
  const [cat, setCat] = useStoredState<Cat>("daily_quote_cat", "trading", CATS);
  const [copied, setCopied] = useState(false);

  const { data, isLoading, isError, refetch } = useGetTodayDailyQuote({
    query: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 } as any,
  });

  const refetchedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!data) return;
    const key = `${(data as any).id ?? "x"}:${lang}`;
    const needsEn = lang === "en" && (!data.tradingEn || !data.psychologyEn);
    if (needsEn && refetchedFor.current !== key) {
      refetchedFor.current = key;
      queryClient.invalidateQueries({ queryKey: getGetTodayDailyQuoteQueryKey() });
    }
  }, [data, lang, queryClient]);

  const regenerate = useRegenerateDailyQuote({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetTodayDailyQuoteQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["daily-quote-recent"] });
        toast({ title: "Цитата обновлена", description: "AI сгенерировал новую пару на сегодня." });
      },
      onError: (e: any) => {
        toast({ title: "Не удалось обновить", description: e?.message || "AI недоступен", variant: "destructive" });
      },
    },
  } as any);

  if (isLoading) {
    return (
      <div className="glass-panel rounded-2xl p-4" aria-busy="true" aria-label="Загрузка цитаты дня">
        <Skeleton className="mb-3 h-3.5 w-32" />
        <Skeleton className="mb-2 h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <WidgetShell icon={Quote} title="Цитата дня">
        <WidgetError message="Не удалось загрузить цитату" onRetry={() => refetch()} />
      </WidgetShell>
    );
  }

  const quoteText = pick(data as QuoteRow, cat, lang);
  const author = cat === "trading" ? data.tradingAuthor : data.psychologyAuthor;
  const CatIcon = cat === "trading" ? TrendingUp : Brain;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(author ? `«${quoteText}» — ${author}` : quoteText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <WidgetShell
      icon={Quote}
      title="Цитата дня"
      actions={
        <>
          <Segmented<Lang>
            ariaLabel="Язык цитаты"
            size="sm"
            value={lang}
            onChange={setLang}
            options={LANGS.map((l) => ({ value: l, label: <span title={LANG_LABELS[l].full} data-testid={`button-quote-lang-${l}`}>{LANG_LABELS[l].short}</span> }))}
          />
          <IconAction icon={copied ? Check : Copy} label={copied ? "Скопировано" : "Скопировать цитату"} onClick={copy} />
          <ArchivePopover lang={lang} cat={cat} />
          {isCurator && (
            <IconAction
              icon={RefreshCw}
              label="Сгенерировать новую цитату"
              spinning={regenerate.isPending}
              disabled={regenerate.isPending}
              onClick={() => regenerate.mutate()}
              data-testid="button-quote-regenerate"
            />
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
        <Segmented<Cat>
          ariaLabel="Категория цитаты"
          size="sm"
          value={cat}
          onChange={setCat}
          className="self-start"
          options={[
            { value: "trading", label: <span className="inline-flex items-center gap-1" data-testid="button-quote-cat-trading"><TrendingUp className="h-3 w-3" aria-hidden="true" />Трейдинг</span> },
            { value: "psychology", label: <span className="inline-flex items-center gap-1" data-testid="button-quote-cat-psychology"><Brain className="h-3 w-3" aria-hidden="true" />Психология</span> },
          ]}
        />
        <figure className="min-w-0 flex-1">
          <blockquote
            key={`${cat}-${lang}`}
            className="text-[15px] font-medium leading-relaxed text-foreground motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
            lang={lang}
            data-testid="text-daily-quote"
          >
            {quoteText}
          </blockquote>
          <figcaption className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <CatIcon className={cn("h-3 w-3", cat === "trading" ? "text-up" : "text-[hsl(var(--chart-5))]")} aria-hidden="true" />
            {author ? `— ${author}` : data.source === "ai" ? "AI · WS_LEXX" : "WS_LEXX"}
          </figcaption>
        </figure>
      </div>
    </WidgetShell>
  );
}
