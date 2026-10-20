/**
 * «Задача дня ждёт» (Волна 1, item 1.8): after «Закрыть день» the journal hands the evening on to the trainer — the
 * ranked «Задача дня» runs from the market close until 08:30 NY of the next trading day (api lib/trainer/daily). Shown
 * only while the challenge can still be played by the viewer (window open, not played yet); one button to /trainer.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Gamepad2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trainerDailyQuery as dailyQuery } from "@/lib/api/queries";
import { dailyCardText } from "@/lib/trainer/daily-window";
import type { DailyChallengeState } from "@/lib/trainer/types";
import { journalI18n } from "@/i18n/ns/journal";

/** The card is worth showing: the ranked window is open and the viewer has not finished this challenge (pure). */
export function dailyTaskWaiting(d: DailyChallengeState | null | undefined): boolean {
  if (!d || d.played) return false;
  return d.window ? d.window.open : d.revealed == null;
}

export function DailyTaskCard({ enabled }: { enabled: boolean }) {
  const { t } = journalI18n.useT();
  const q = useQuery({ ...dailyQuery(), enabled, retry: false });
  if (!enabled || !dailyTaskWaiting(q.data)) return null;
  const line = dailyCardText(q.data!).window;
  return (
    <section aria-label={t("dailyTask.title")} className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3 sm:flex-row sm:items-center sm:gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
        <Gamepad2 className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{t("dailyTask.title")}</p>
        <p className="text-xs text-muted-foreground">{t("dailyTask.hint")}</p>
        {line && <p className="text-xs font-medium">{line}</p>}
      </div>
      <Button asChild className="min-h-11 sm:min-h-9">
        <Link href="/trainer">
          <Play aria-hidden="true" />
          {t("dailyTask.cta")}
        </Link>
      </Button>
    </section>
  );
}
