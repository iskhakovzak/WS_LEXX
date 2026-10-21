import { Link } from "wouter";
import { BookMarked, ChevronRight } from "lucide-react";
import { openSetupSheet } from "@/components/shared/playbook-sheet";
import { playbookTodayI18n } from "@/i18n/ns/playbookToday";
import type { DayPlaybook } from "./daily-model";

/**
 * «Сегодня торгую: 1.3 ORB · 2.1 VWAP Hold» — today's picks from the playbook (saved into the personal plan). A chip
 * opens the cheat sheet over the dashboard; nothing picked yet → one quiet link to «Сегодня» in the playbook.
 */
export function PicksLine({ playbook }: { playbook: DayPlaybook }) {
  const { t } = playbookTodayI18n.useT();
  if (!playbook.picks.length) {
    return (
      <Link href="/playbook" className="group inline-flex min-h-8 items-center gap-1.5 self-start rounded-lg text-xs text-muted-foreground hover:text-foreground">
        <BookMarked className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {t("dayRow.picks")} · {t("plan.edit")}
        <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
      </Link>
    );
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <BookMarked className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        {t("dayRow.picks")}:
      </span>
      {playbook.picks.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => openSetupSheet({ setupId: p.id })}
          title={t("dayRow.open", { name: p.name })}
          aria-haspopup="dialog"
          className="chip min-h-8 max-w-[14rem] truncate px-2.5 text-xs font-medium text-foreground"
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}
