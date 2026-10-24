/** The state when the assistant cannot answer: no key on the server (with the admin's steps), switched off, or closed for the stage. */
import { KeyRound, Lock } from "lucide-react";
import { assistantI18n } from "@/i18n/ns/assistant";
import type { AssistantStatus } from "./api";

export function Unavailable({ status }: { status: AssistantStatus }) {
  const { t } = assistantI18n.useT();
  if (status.blocked === "AI_ASSISTANT_OFF" || status.blocked === "AI_ASSISTANT_STAGE") {
    return (
      <div className="flex flex-col items-start gap-3 py-4">
        <div className="grid h-10 w-10 place-items-center rounded-full bg-[var(--glass-bg)] text-muted-foreground"><Lock className="h-5 w-5" aria-hidden="true" /></div>
        <p className="text-sm text-muted-foreground">{status.blocked === "AI_ASSISTANT_OFF" ? t("blocked.off") : t("blocked.stage")}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-3 py-4" data-testid="assistant-not-configured">
      <div className="grid h-10 w-10 place-items-center rounded-full bg-warn/12 text-warn"><KeyRound className="h-5 w-5" aria-hidden="true" /></div>
      <div>
        <h3 className="text-base font-semibold text-foreground">{t("notConfigured.title")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t("notConfigured.body")}</p>
      </div>
      {status.canConfigure ? (
        <section className="w-full rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 text-sm">
          <h4 className="font-medium text-foreground">{t("notConfigured.adminTitle")}</h4>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted-foreground marker:text-muted-foreground">
            <li>{t("notConfigured.step1")}</li>
            <li className="[overflow-wrap:anywhere]">{t("notConfigured.step2")}</li>
            <li>{t("notConfigured.step3")}</li>
          </ol>
          <p className="mt-2 text-xs text-muted-foreground">{t("notConfigured.docs")}</p>
        </section>
      ) : null}
    </div>
  );
}
