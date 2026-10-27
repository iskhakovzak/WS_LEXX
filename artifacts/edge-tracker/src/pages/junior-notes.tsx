/**
 * «Сводка джунов» — LEGACY, read-only (Волна 1, item 1.5: one evening form). The evening summary is the journal's
 * «Закрыть день» now (what went well / what to fix / focus for tomorrow → eod_days.summary; the curator answers in the
 * one EOD queue, the trader gets the eod_reviewed notification; the focus prefills tomorrow's plan). This page only
 * reads the old notes (GET /api/junior-notes/history) with the curator's feedback; no editor, reminders or team tools.
 * Nothing is deleted. The menu has no entry for it any more (components/shell/nav.ts: hidden).
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Archive, NotebookPen, NotebookText } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { EmptyState, Page, PageHeader, Panel } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { qk, type JuniorNote } from "@/components/notes/junior-lib";
import { http } from "@/lib/api/http";
import { links } from "@/lib/links";
import { JuniorHistory } from "@/components/notes/junior-history";
import { notesI18n } from "@/i18n/ns/notes";
import { journalI18n } from "@/i18n/ns/journal";

export default function JuniorNotesPage() {
  const { user } = useAuth();
  const { t } = notesI18n.useT();
  const { t: tj } = journalI18n.useT();
  const [, navigate] = useLocation();
  const trader = user?.traderName ?? "";

  const historyQ = useQuery({
    queryKey: qk.history(trader),
    queryFn: () => http.get<JuniorNote[]>(`/api/junior-notes/history?trader=${encodeURIComponent(trader)}&limit=250`),
    enabled: !!trader,
    staleTime: 60_000,
  });
  const history = React.useMemo(() => (Array.isArray(historyQ.data) ? historyQ.data : []), [historyQ.data]);
  // An old note's day opens where the evening lives now: the journal of that day.
  const openDay = React.useCallback((d: string) => navigate(links.journalDay(d, trader)), [navigate, trader]);

  return (
    <Page>
      <PageHeader title={t("junior.title")} icon={NotebookText} description={tj("legacyNotes.description")} />
      <Panel>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Archive className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{tj("legacyNotes.title")}</p>
            <p className="text-xs text-muted-foreground">{tj("legacyNotes.hint")}</p>
          </div>
          <Button asChild className="min-h-11 sm:min-h-9">
            <Link href="/journal">{tj("legacyNotes.toJournal")}</Link>
          </Button>
        </div>
      </Panel>
      {!trader ? (
        <Panel>
          <EmptyState icon={NotebookPen} title={t("junior.signInTitle")} description={t("junior.signInDescription")} />
        </Panel>
      ) : (
        <JuniorHistory
          history={history}
          isLoading={historyQ.isLoading}
          isError={historyQ.isError}
          onRetry={() => void historyQ.refetch()}
          onOpenInEditor={openDay}
        />
      )}
    </Page>
  );
}
