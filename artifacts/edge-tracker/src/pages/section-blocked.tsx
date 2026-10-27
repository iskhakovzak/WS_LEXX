/**
 * «Раздел закрыт для вашей ступени» — what a trader sees when a section closed for their ladder stage (desk setting
 * access.sections, admin → «Роли и права» → «Доступ по ступеням») is opened by URL, a bookmark or an old link. The menu
 * never offers it (components/shell/nav-model); the API answers 403 SECTION_BLOCKED anyway. Says which section, for
 * which stage, and who to ask: the assigned curator by name when there is one (GET /api/users/me/profile), else «a
 * curator or an admin».
 * `reason="off"`: the desk switched the section off for everyone (a feature switch such as nav.authorNotes) — «Раздел
 * выключен администратором» instead of a 404 that says the link is broken.
 */
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { routeTitle } from "@/components/shell/nav";
import { stageOfTier } from "@/components/shell/nav-model";
import { useAuth } from "@/contexts/auth-context";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import { personName } from "@/i18n";
import { commonI18n } from "@/i18n/ns/common";
import { shellI18n } from "@/i18n/ns/shell";

export default function SectionBlocked({ section, reason = "stage" }: { section: string; reason?: "stage" | "off" }) {
  const { t } = shellI18n.useT();
  const { t: tc } = commonI18n.useT();
  const { permissions } = useAuth();
  const profile = useQuery<{ assignedCurator?: string | null } | null>({
    queryKey: ["users", "me", "profile", "curator"],
    queryFn: ({ signal }) => http.get<{ assignedCurator?: string | null }>("/api/users/me/profile", { signal }).catch(() => null),
    staleTime: STALE.short,
    meta: { i18n: false },
    enabled: reason === "stage",
  });
  const off = reason === "off";
  const curator = profile.data?.assignedCurator ?? null;
  const name = routeTitle(section) ?? section;
  const stage = tc(`tiers.${stageOfTier(permissions.tier)}`);
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center px-1 py-8">
      <div role="status" className="glass-panel w-full max-w-md rounded-3xl p-6 text-center sm:p-8">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/15 text-primary">
          <Lock className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-foreground">{off ? t("sectionOff.title") : t("sectionBlocked.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{off ? t("sectionOff.lead", { section: name }) : t("sectionBlocked.lead", { section: name, stage })}</p>
        <p className="mt-2 text-sm text-foreground">
          {off ? t("sectionOff.ask") : curator ? t("sectionBlocked.askCurator", { name: personName(curator) }) : t("sectionBlocked.askStaff")}
        </p>
        <div className="mt-5 flex justify-center">
          <Button asChild>
            <Link href="/">
              <LayoutDashboard aria-hidden="true" />
              {t("sectionBlocked.toDashboard")}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
