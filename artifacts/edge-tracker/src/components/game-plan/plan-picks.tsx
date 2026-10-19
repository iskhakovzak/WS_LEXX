import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { BookMarked } from "lucide-react";
import { openSetupSheet } from "@/components/shared/playbook-sheet";
import { playbookTodayQuery } from "@/lib/api/queries";
import { playbookTodayI18n } from "@/i18n/ns/playbookToday";

/**
 * «Сегодня торгую» in the personal plan: the setups picked in the playbook for the day (doc.setups, written by
 * PUT /api/playbook/today/picks). `ids` — a stored plan's own list (curator view); otherwise today's picks when the plan
 * is today's. A chip opens the cheat sheet; the link goes to the playbook to change the pick.
 */
export function PlanPicks({ date, ids }: { date?: string; ids?: number[] | null }) {
  const { t } = playbookTodayI18n.useT();
  const today = useQuery({ ...playbookTodayQuery(), retry: false }).data ?? null;
  if (!today) return null;
  const isToday = !date || today.date === date;
  const list = ids ?? (isToday ? today.picks : []);
  if (!list.length && (ids || !isToday)) return null;
  const names = new Map(today.setups.map((s) => [s.id, s.name]));
  return (
    <div className="mb-3 flex min-w-0 flex-wrap items-center gap-1.5 text-sm">
      <span className="inline-flex items-center gap-1.5 font-semibold">
        <BookMarked className="h-4 w-4 text-primary" aria-hidden="true" />
        {t("plan.picks")}
      </span>
      {list.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => openSetupSheet({ setupId: id })}
          aria-haspopup="dialog"
          className="chip min-h-7 max-w-[14rem] truncate px-2.5 text-xs font-medium text-foreground"
        >
          {names.get(id) ?? `#${id}`}
        </button>
      ))}
      {!ids && (
        <Link href="/playbook" className="text-xs font-medium text-primary hover:underline">
          {t("plan.edit")}
        </Link>
      )}
    </div>
  );
}
