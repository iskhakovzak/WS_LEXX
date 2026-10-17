/**
 * «Спроси журнал» — questions about the trade book in plain Russian, parsed deterministically (no AI).
 * Route /ask?q=<phrase> (the command palette can deep-link here). The book is loaded once and every question
 * runs on the client.
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { MessageSquareText } from "lucide-react";
import { ErrorState, Page, PageHeader, Panel } from "@/components/ds";
import { useAuth } from "@/contexts/auth-context";
import { nyDate } from "@/lib/trading-date";
import { parseAsk, removeToken, replaceToken, type ParseContext } from "@/lib/ask/parse";
import { ASK_BOOK_KEY, fetchAskBook, runAsk, type AskBook } from "@/lib/ask/run";
import { dmy, tradesWord } from "@/lib/ask/aggregate";
import { AskBar } from "@/components/ask/AskBar";
import { AskNotUnderstood, AskResult, AskResultSkeleton } from "@/components/ask/AskResult";
import { AskSidebar } from "@/components/ask/AskSidebar";
import { AskOverview } from "@/components/ask/AskOverview";
import { useAskMemory } from "@/components/ask/use-ask-memory";

function readQ(search: string): string {
  try {
    return new URLSearchParams(search).get("q")?.trim() ?? "";
  } catch {
    return "";
  }
}

export default function AskPage() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const { user, dbUsers, isCurator, isAdmin } = useAuth();
  const isStaff = isCurator || isAdmin;
  const me = user?.role !== "guest" ? user?.traderName ?? null : null;
  const memory = useAskMemory();

  const submitted = readQ(search);
  const [input, setInput] = useState(submitted);
  useEffect(() => { setInput(submitted); }, [submitted]);

  const book = useQuery<AskBook>({
    queryKey: ASK_BOOK_KEY,
    queryFn: ({ signal }) => fetchAskBook(signal),
    staleTime: 5 * 60_000,
  });

  const today = nyDate();
  const traderNames = useMemo(() => {
    const fromBook = book.data?.traders.map((t) => t.value) ?? [];
    return [...new Set([...fromBook, ...dbUsers.map((u) => u.name).filter(Boolean)])];
  }, [book.data, dbUsers]);
  const tickerNames = useMemo(() => book.data?.tickers.map((t) => t.value) ?? [], [book.data]);
  const setupNames = useMemo(() => book.data?.setups.map((t) => t.value) ?? [], [book.data]);
  const ctx = useMemo<ParseContext>(
    () => ({ today, traders: isStaff ? traderNames : [], tickers: tickerNames, setups: setupNames }),
    [today, isStaff, traderNames, tickerNames, setupNames],
  );

  const query = useMemo(() => (submitted ? parseAsk(submitted, ctx) : null), [submitted, ctx]);
  const result = useMemo(() => (query?.ok && book.data ? runAsk(query, book.data, { me }) : null), [query, book.data, me]);

  const ask = (text: string) => {
    const t = text.trim();
    if (!t) return;
    memory.remember(t);
    setInput(t);
    navigate(`/ask?q=${encodeURIComponent(t)}`);
    document.getElementById("main-content")?.scrollTo({ top: 0 });
  };
  const onRemove = (key: string) => {
    if (!query) return;
    const text = removeToken(query, key, ctx).raw.trim();
    if (!text) { setInput(""); navigate("/ask"); return; }
    ask(text);
  };
  const onReplace = (key: string, text: string) => {
    if (query) ask(replaceToken(query, key, text));
  };

  const meta = book.data ? (
    <span className="tabular-nums">
      {tradesWord(book.data.trades.length)} в журнале
      {book.data.firstDate && book.data.lastDate ? ` · ${dmy(book.data.firstDate)} — ${dmy(book.data.lastDate)}` : ""}
      {book.data.truncated ? " · загружены не все" : ""}
    </span>
  ) : book.isLoading ? <span>Загружаю сделки…</span> : null;

  return (
    <Page>
      <PageHeader
        title="Спроси журнал"
        icon={MessageSquareText}
        description="Вопрос обычными словами — ответ сразу: цифра, вывод, график и сделки. Разбор по правилам, без ИИ."
        meta={meta}
      />

      <div className="grid min-w-0 items-start gap-[var(--page-gap)] xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-[var(--page-gap)]">
          <Panel>
            <AskBar
              value={input}
              onChange={setInput}
              onSubmit={ask}
              ctx={ctx}
              tickers={book.data?.tickers}
              setups={book.data?.setups}
              history={memory.history}
              pinned={memory.pinned}
              autoFocus={!submitted}
            />
          </Panel>

          {book.isError ? (
            <ErrorState title="Не удалось загрузить сделки" error={book.error} onRetry={() => book.refetch()} />
          ) : query && !query.ok ? (
            <AskNotUnderstood query={query} tickers={tickerNames} onAsk={ask} />
          ) : query && !result ? (
            <AskResultSkeleton />
          ) : query && result ? (
            <AskResult
              query={query}
              answer={result.answer}
              href={result.href}
              index={book.data!.index}
              defaultTrader={result.defaultTrader}
              isStaff={isStaff}
              tickers={tickerNames}
              setups={setupNames}
              pinned={memory.isPinned(query.raw)}
              onTogglePin={() => memory.togglePin(query.raw)}
              onAsk={ask}
              onReplace={onReplace}
              onRemove={onRemove}
            />
          ) : (
            <AskOverview book={book.data ?? null} ctx={ctx} me={me} onAsk={ask} />
          )}
        </div>

        <AskSidebar memory={memory} current={submitted} onAsk={ask} />
      </div>
    </Page>
  );
}
