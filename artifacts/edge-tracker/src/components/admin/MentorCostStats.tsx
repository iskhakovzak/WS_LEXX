/**
 * Admin → desk settings → «AI-ментор»: what the mentor cost (GET /api/mentor/admin/cost, settings.manage) — calls,
 * people, $ for the live calls (brief / debrief / week / conversation, charged to each person's daily AI budget) and
 * the batch pushes (half price, the desk's push budget), per day. Read from the assistant audit (mode mentor*).
 */
import { useQuery } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import { fmtCount, fmtDate, fmtUsd } from "@/lib/format";
import { deskSettingsI18n } from "@/i18n/ns/deskSettings";

type Cost = {
  from: string; to: string; calls: number; users: number; costUsd: number; liveUsd: number; batchUsd: number; errors: number;
  days: { day: string; calls: number; costUsd: number }[]; enabled: boolean; pushesEnabled: boolean;
};

const DAYS = 14;
const usd = (v: number) => fmtUsd(v, { decimals: v < 1 ? 4 : 2 });

export function MentorCostStats() {
  const { t } = deskSettingsI18n.useT();
  const q = useQuery({
    queryKey: ["mentor", "admin-cost", DAYS],
    queryFn: ({ signal }) => http.get<Cost>("/api/mentor/admin/cost", { query: { days: String(DAYS) }, signal }),
    staleTime: STALE.short,
  });
  const v = q.data;
  return (
    <section className="space-y-2 py-4" aria-label={t("mentorCost.title")} data-testid="mentor-cost">
      <div>
        <h4 className="text-sm font-semibold text-foreground">{t("mentorCost.title")}</h4>
        <p className="text-xs text-muted-foreground">{t("mentorCost.hint", { days: DAYS })}</p>
      </div>
      {q.isError ? <p className="text-xs text-down">{t("mentorCost.loadFailed")}</p> : null}
      {v ? (
        <>
          {!v.enabled && <p className="text-xs text-muted-foreground">{t("mentorCost.off")}</p>}
          {v.calls === 0 ? <p className="text-xs text-muted-foreground">{t("mentorCost.empty")}</p> : (
            <>
              <p className="text-xs tabular-nums text-foreground">{t("mentorCost.total", { calls: fmtCount(v.calls), users: fmtCount(v.users), usd: usd(v.costUsd) })}</p>
              <p className="text-xs tabular-nums text-muted-foreground">
                {t("mentorCost.split", { live: usd(v.liveUsd), batch: usd(v.batchUsd) })}
                {v.errors ? ` · ${t("mentorCost.errors", { count: v.errors })}` : ""}
              </p>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground">
                {v.days.slice(-7).map((d) => <li key={d.day}>{fmtDate(d.day, "dayMonth")}: {fmtCount(d.calls)} · {usd(d.costUsd)}</li>)}
              </ul>
            </>
          )}
        </>
      ) : null}
    </section>
  );
}
