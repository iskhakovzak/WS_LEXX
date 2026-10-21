import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { links } from "@/lib/links";
import { journalI18n } from "@/i18n/ns/journal";

/**
 * «Итог дня» without trades. On the trader's own empty today «Начните с плана на день» is an action (a link to the
 * plan), not just a sentence; a curator looking at someone else's day gets a neutral line instead.
 */
export function EmptyDayNote({ date, today, own, opened }: { date: string; today: string; own: boolean; opened: number }) {
  const { t } = journalI18n.useT();
  const isToday = date === today;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-1">
      <p className="text-sm text-muted-foreground">
        {date > today ? t("page.futureDay")
          : opened ? t("page.openedPositions", { count: opened })
          : isToday ? (own ? t("page.noTradesToday") : t("page.noTradesYet"))
          : t("page.noTradesDay")}
      </p>
      {isToday && own && !opened && (
        <Button asChild variant="outline" size="sm">
          <Link href={links.myPlan(today)}>{t("page.openPlan")}<ArrowRight /></Link>
        </Button>
      )}
    </div>
  );
}
