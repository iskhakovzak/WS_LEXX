import { Snowflake } from "lucide-react";
import type { StreakFreeze } from "@/lib/gamification/types";
import { cn } from "@/lib/utils";
import { fmtDayMonth } from "@/lib/format";
import { gamificationI18n } from "@/i18n/ns/gamification";

/** «Серию сохранила заморозка: 14 окт» — for a tooltip on the streak (dashboard day row); null when none was used. */
export function freezeUsedText(freeze: StreakFreeze | null | undefined): string | null {
  if (!freeze?.usedOn.length) return null;
  return gamificationI18n.t("freeze.used", { dates: freeze.usedOn.map((d) => fmtDayMonth(d)).join(", ") });
}

/**
 * «Заморозка серии: 1 из 2 в этом месяце · Серию сохранила заморозка: 14 окт» — the dashboard rewards block and the
 * «Квесты и достижения» header. Hidden when the desk gives no freezes and none was used.
 */
export function FreezeLine({ freeze, className }: { freeze: StreakFreeze | null | undefined; className?: string }) {
  const { t } = gamificationI18n.useT();
  if (!freeze || (freeze.perMonth <= 0 && freeze.usedOn.length === 0)) return null;
  const used = freezeUsedText(freeze);
  return (
    <div className={cn("flex min-w-0 items-start gap-1.5 text-xs", className)} title={t("freeze.hint")}>
      <Snowflake className={cn("mt-px h-3.5 w-3.5 shrink-0", freeze.available > 0 ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
      <p className="min-w-0">
        <span className="font-medium text-foreground">
          {freeze.available > 0 ? t("freeze.line", { available: freeze.available, perMonth: freeze.perMonth }) : t("freeze.none")}
        </span>
        {used && <span className="text-muted-foreground"> · {used}</span>}
      </p>
    </div>
  );
}
