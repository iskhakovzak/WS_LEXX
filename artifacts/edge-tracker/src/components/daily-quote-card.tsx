/**
 * Dashboard «Цитата дня»: a quote from the curated library (served by the API — api-server routes/quotes.ts, ~1,800
 * entries in ru / uz / uk / en — gods and heroes of Homer and the tragedians, philosophers and Stoics, classics of
 * discipline, traders, psychology), one per trading day from the reader's no-repeat cycle, plus «Следующая». Author, precise source and a reliability
 * badge; copy, «Картинка с цитатой» on an «Олимп» artwork, favourites and history; categories to show; the old AI
 * pair stays as an optional extra. Mounted by the dashboard as `<DailyQuoteCard />` (no props).
 */
import * as React from "react";
import { ArrowRight, Check, Copy, History, ImageIcon, MoreHorizontal, Quote as QuoteIcon, Sparkles, Star } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Segmented } from "@/components/ds";
import { getLang } from "@/i18n";
import { quotesI18n } from "@/i18n/ns/quotes";
import { WidgetShell, IconAction, WidgetError, useStoredState } from "@/components/widgets/widget-kit";
import { quotePlainText } from "@/lib/quotes/format";
import { QUOTE_CATS, QUOTE_LANGS, type QuoteCat, type QuoteLang } from "@/lib/quotes/types";
import { QUOTE_LANG_KEY } from "@/lib/quotes/store";
import { MOOD_TAGS } from "@/lib/quotes/context";
import { CAT_ICON, QuoteBody } from "@/components/quotes/quote-body";
import { QuoteHistory } from "@/components/quotes/quote-history";
import { AiQuotePanel } from "@/components/quotes/ai-quote";
import { useDashQuote, useQuotePrefs } from "@/components/quotes/use-quote-feed";
import { useQuote } from "@/lib/quotes/hooks";

const QuoteShareDialog = React.lazy(() => import("@/components/quotes/quote-share-dialog"));

const LANG_LABELS: Record<QuoteLang, { short: string; full: string }> = {
  ru: { short: "RU", full: "Русский" }, // i18n-ignore (native language name)
  uz: { short: "UZ", full: "Oʻzbek" },
  uk: { short: "UK", full: "Українська" }, // i18n-ignore (native language name)
  en: { short: "EN", full: "English" },
};

export function DailyQuoteCard() {
  const { t } = quotesI18n.useT();
  const { user, isCurator } = useAuth();
  const name = user?.role !== "guest" ? user?.traderName ?? null : null;
  // First visit: the quote follows the interface language; the reader's own pick is remembered after that.
  const uiLang = getLang();
  const [lang, setLang] = useStoredState<QuoteLang>(QUOTE_LANG_KEY, uiLang === "en" || uiLang === "uz" ? uiLang : "ru", QUOTE_LANGS);
  const { prefs, save, toggleFav } = useQuotePrefs(name, !!name);
  const feed = useDashQuote(lang, prefs, name);
  const [viewId, setViewId] = React.useState<string | null>(null);
  const shown = useQuote(lang, viewId ?? feed.currentId);
  const [copied, setCopied] = React.useState(false);
  const [shareOpen, setShareOpen] = React.useState(false);
  const [ai, setAi] = React.useState(false);

  const quote = shown.quote;
  if (!quote && (feed.error || shown.isError)) {
    return (
      <WidgetShell icon={QuoteIcon} title={t("title")}>
        <WidgetError message={t("loadFailed")} onRetry={() => { feed.retry(); void shown.refetch(); }} />
      </WidgetShell>
    );
  }
  if (!quote) {
    return (
      <div className="glass-panel rounded-2xl p-4" aria-busy="true" aria-label={t("loading")}>
        <Skeleton className="mb-3 h-3.5 w-32" />
        <Skeleton className="mb-2 h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }

  const fav = prefs.favs.includes(quote.id);
  // The mood line only on the day's own context-matched draw.
  const moodHit = !!feed.mood && quote.id === feed.dayId && quote.tags.some((tg) => MOOD_TAGS[feed.mood!].includes(tg));
  const note = moodHit ? t(feed.mood === "red" ? "mood.red" : "mood.green") : null;
  const cats = prefs.cats;
  const catOn = (c: QuoteCat) => cats.length === 0 || cats.includes(c);
  const toggleCat = (c: QuoteCat) => {
    const on = QUOTE_CATS.filter(catOn);
    const next = on.includes(c) ? on.filter((x) => x !== c) : [...on, c];
    if (next.length === 0) return; // at least one category stays on
    save({ ...prefs, cats: next.length === QUOTE_CATS.length ? [] : QUOTE_CATS.filter((x) => next.includes(x)) });
    setViewId(null);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(quotePlainText(quote, lang));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <WidgetShell
      icon={QuoteIcon}
      title={t("title")}
      data-testid="daily-quote-card"
      actions={
        <>
          <Segmented<QuoteLang>
            ariaLabel={t("langAria")}
            size="sm"
            value={lang}
            onChange={setLang}
            options={QUOTE_LANGS.map((l) => ({ value: l, label: <span title={LANG_LABELS[l].full} data-testid={`button-quote-lang-${l}`}>{LANG_LABELS[l].short}</span> }))}
          />
          <IconAction
            icon={Star}
            label={fav ? t("favRemove") : t("favAdd")}
            active={fav}
            aria-pressed={fav}
            onClick={() => toggleFav(quote.id)}
            className={fav ? "[&_svg]:fill-current" : undefined}
            data-testid="button-quote-fav"
          />
          <QuoteHistory
            lang={lang}
            history={feed.history}
            favs={prefs.favs}
            onOpen={(id) => { setAi(false); setViewId(id); }}
            trigger={<IconAction icon={History} label={t("history.button")} data-testid="button-quote-history" />}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconAction icon={MoreHorizontal} label={t("more")} data-testid="button-quote-more" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onSelect={() => void copy()}>
                {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                {copied ? t("copied") : t("copy")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setShareOpen(true)} data-testid="button-quote-share">
                <ImageIcon className="h-4 w-4" aria-hidden="true" /> {t("share")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setAi(true)}>
                <Sparkles className="h-4 w-4" aria-hidden="true" /> {t("ai.button")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs">{t("cats.label")}</DropdownMenuLabel>
              {QUOTE_CATS.map((c) => {
                const Icon = CAT_ICON[c];
                return (
                  <DropdownMenuCheckboxItem key={c} checked={catOn(c)} onCheckedChange={() => toggleCat(c)} onSelect={(e) => e.preventDefault()} className="gap-2" data-testid={`quote-cat-${c}`}>
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> {t(`cat.${c}`)}
                  </DropdownMenuCheckboxItem>
                );
              })}
              <p className="px-2 pb-1.5 pt-1 text-2xs leading-snug text-muted-foreground">{t("cats.hint")}</p>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      {ai ? (
        <AiQuotePanel lang={lang} staff={isCurator} onBack={() => setAi(false)} />
      ) : (
        <>
          <QuoteBody quote={quote} lang={lang} note={note} />
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-2xs tabular-nums text-muted-foreground">{feed.total != null ? t("library", { count: feed.total }) : null}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => { setViewId(null); feed.next(); }}
              onPointerEnter={feed.prefetchNext}
              onFocus={feed.prefetchNext}
              data-testid="button-quote-next"
            >
              {t("nextShort")} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        </>
      )}
      {shareOpen && (
        <React.Suspense fallback={null}>
          <QuoteShareDialog quote={quote} lang={lang} open={shareOpen} onOpenChange={setShareOpen} />
        </React.Suspense>
      )}
    </WidgetShell>
  );
}
