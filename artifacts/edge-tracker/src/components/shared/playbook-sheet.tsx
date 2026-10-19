/**
 * Open the playbook over the current page from any feature (command palette «Сетап…», chart pages, the dashboard day
 * row, the evening card): a window event the root host (components/playbook-sheet-host.tsx) listens to and answers with
 * a sheet (right side on desktop, bottom sheet on phones). Features never import the playbook feature for this.
 */
import { BookMarked } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { playbookTodayI18n } from "@/i18n/ns/playbookToday";

export const PLAYBOOK_SHEET_EVENT = "ws-playbook-sheet";

/** `setup`: the cheat sheet (one setup, or the searchable list prefilled with `query`); `tag`: «Разметить сделки». */
export type PlaybookSheetRequest = { kind: "setup"; setupId?: number | null; query?: string } | { kind: "tag"; day?: string | null };

function send(detail: PlaybookSheetRequest) {
  window.dispatchEvent(new CustomEvent<PlaybookSheetRequest>(PLAYBOOK_SHEET_EVENT, { detail }));
}

/** The cheat sheet of one setup, or the list (optionally searched, e.g. «ORB»). */
export function openSetupSheet(opts: { setupId?: number | null; query?: string } = {}) {
  send({ kind: "setup", setupId: opts.setupId ?? null, query: opts.query });
}

/** The tagging UI (own trades without a setup) in a sheet — the evening «Разметь N сделок» step; `day` narrows it to
 * one NY trading day (the evening card's day, the quest link `/?tagDay=YYYY-MM-DD`). */
export function openTaggingSheet(day?: string | null) {
  send({ kind: "tag", day: day ?? null });
}

/** Small «Плейбук» button for chart pages (trade sheet, desk-day, chart lab). */
export function PlaybookSheetButton({ className, query }: { className?: string; query?: string }) {
  const { t } = playbookTodayI18n.useT();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("h-9 shrink-0 gap-1.5", className)}
      onClick={() => openSetupSheet({ query })}
      title={t("chartButton.title")}
      aria-haspopup="dialog"
    >
      <BookMarked className="h-4 w-4" aria-hidden="true" />
      <span className="hidden sm:inline">{t("chartButton.label")}</span>
      <span className="sr-only sm:hidden">{t("chartButton.label")}</span>
    </Button>
  );
}
