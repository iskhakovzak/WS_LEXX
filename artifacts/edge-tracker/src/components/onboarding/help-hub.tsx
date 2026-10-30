/**
 * «Помощь» (user menu, Ctrl+K «Помощь и подсказки», the «?» key): the daily-loop tour (again, or continued where it was
 * left), «Справочник» — every tool by the day's rhythm (/guide, the same texts as the «?» buttons) — and the keyboard
 * shortcuts. A lazy chunk of the onboarding host.
 */
import { LifeBuoy, Route as RouteIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ds";
import { onboardingI18n } from "@/i18n/ns/onboarding";

export type GoShortcut = { key: string; label: string };

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = IS_MAC ? "⌘" : "Ctrl";

export default function HelpHub({
  open, onOpenChange, goKeys, resumeAt, onRestart, onGuide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goKeys: GoShortcut[];
  /** The tour was left on this step (1-based): «Продолжить» is offered first. */
  resumeAt: number | null;
  onRestart: (resume: boolean) => void;
  /** Opens «Справочник»; null when the section is closed for the viewer. */
  onGuide: (() => void) | null;
}) {
  const { t } = onboardingI18n.useT();
  const row = "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const icon = "grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/12 text-primary";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("help.title")}</DialogTitle>
          <DialogDescription>{t("help.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          {resumeAt != null && (
            <button type="button" onClick={() => onRestart(true)} className={`${row} glass-field`}>
              <span className={icon}><RouteIcon className="h-4 w-4" aria-hidden="true" /></span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">{t("help.resume")}</span>
                <span className="block text-xs text-muted-foreground">{t("help.resumeHint", { n: resumeAt })}</span>
              </span>
            </button>
          )}
          <button type="button" onClick={() => onRestart(false)} className={resumeAt != null ? row : `${row} glass-field`}>
            <span className={icon}><RouteIcon className="h-4 w-4" aria-hidden="true" /></span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-foreground">{t("help.restart")}</span>
              <span className="block text-xs text-muted-foreground">{t("help.restartHint")}</span>
            </span>
          </button>
          {onGuide && (
            <button type="button" onClick={onGuide} className={row}>
              <span className={icon}><LifeBuoy className="h-4 w-4" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">{t("help.guide")}</span>
                <span className="block text-xs text-muted-foreground">{t("help.guideHint")}</span>
              </span>
              <span className="shrink-0 self-center text-xs text-primary">{t("help.open")}</span>
            </button>
          )}
        </div>

        <section aria-labelledby="help-keys" className="hidden md:block">
          <h3 id="help-keys" className="mb-2 px-1 text-xs font-medium text-muted-foreground">{t("help.keysTitle")}</h3>
          <dl className="grid gap-x-6 gap-y-2 px-1 text-sm sm:grid-cols-2">
            <Shortcut keys={[MOD, "K"]} label={t("help.keys.palette")} />
            <Shortcut keys={[MOD, "B"]} label={t("help.keys.sidebar")} />
            <Shortcut keys={["Esc"]} label={t("help.keys.close")} />
            <Shortcut keys={["←", "→"]} label={t("help.keys.steps")} />
            <Shortcut keys={["?"]} label={t("help.title")} />
          </dl>
          {goKeys.length > 0 && (
            <>
              <p className="mb-2 mt-4 px-1 text-xs text-muted-foreground">{t("help.keys.go")}</p>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 px-1 text-sm sm:grid-cols-3">
                {goKeys.map((g) => <Shortcut key={g.key} keys={["G", g.key.toUpperCase()]} label={g.label} />)}
              </dl>
            </>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}

function Shortcut({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <dt className="min-w-0 truncate text-foreground" title={label}>{label}</dt>
      <dd className="shrink-0"><Kbd keys={keys} /></dd>
    </div>
  );
}
