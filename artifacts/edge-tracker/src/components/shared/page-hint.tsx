/**
 * Page hints (lib/onboarding): ONE quiet inline note on a complex page — what the page answers, in one sentence, and the
 * one thing to try first. Opens by itself on the first visit for people who are still new (stage new / settling,
 * see lib/onboarding/model shouldAutoHint), once per page per user; `HelpButton` («?» in the page header) and «Помощь»
 * bring it back any time. Not a banner: it sits under the header, in the page's own glass, and closes for good.
 *
 *   <PageHeader … actions={<><HelpButton id="analytics" />…</>} />
 *   <PageHint id="analytics" />
 */
import { useEffect, useRef, useState } from "react";
import { CircleHelp, Lightbulb, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { onboardingI18n } from "@/i18n/ns/onboarding";
import { shouldAutoHint, type HintId } from "@/lib/onboarding/model";
import { markHintSeen, reopenHint, useOnboarding } from "@/lib/onboarding/store";

export function PageHint({ id, className }: { id: HintId; className?: string }) {
  const { t } = onboardingI18n.useT();
  const ob = useOnboarding();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const decided = useRef(false);

  // Auto: decided once per visit, when the stored state is known (no flash in and out while the server answers).
  useEffect(() => {
    if (decided.current || !ob.ready || (ob.mode === "auto" && !ob.status)) return;
    decided.current = true;
    if (shouldAutoHint({ mode: ob.mode, stage: ob.status?.stage ?? null, state: ob.state, id })) {
      setOpen(true);
      markHintSeen(id); // shown = seen: it never pops up again by itself, even if left open
    }
  }, [ob.ready, ob.mode, ob.status, ob.state, id]);

  // «?» / «Помощь» re-open it, in view.
  const reopenN = ob.reopen?.id === id ? ob.reopen.n : 0;
  useEffect(() => {
    if (!reopenN) return;
    setOpen(true);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" }));
  }, [reopenN]);

  if (!open) return null;
  const close = () => { setOpen(false); markHintSeen(id); };
  return (
    <aside
      ref={ref}
      aria-label={t(`hints.pages.${id}.page`)}
      className={cn("glass-panel flex items-start gap-3 rounded-2xl px-4 py-3 print:hidden", className)}
    >
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/12 text-primary">
        <Lightbulb className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="text-foreground">{t(`hints.pages.${id}.answer`)}</p>
        <p className="mt-0.5 text-muted-foreground">
          <span className="font-medium text-foreground/80">{t("hints.tryFirst")}</span> {t(`hints.pages.${id}.try`)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" className="hidden sm:inline-flex" onClick={close}>{t("hints.close")}</Button>
        <button
          type="button"
          onClick={close}
          aria-label={t("hints.close")}
          className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}

/** «?» for the page header: brings the page's hint back. */
export function HelpButton({ id, className }: { id: HintId; className?: string }) {
  const { t } = onboardingI18n.useT();
  const page = t(`hints.pages.${id}.page`);
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("print:hidden", className)}
      onClick={() => reopenHint(id)}
      aria-label={t("hints.helpAria", { page })}
      title={t("hints.help")}
    >
      <CircleHelp className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}
