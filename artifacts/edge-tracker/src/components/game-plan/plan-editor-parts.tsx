import { useState } from "react";
import { ChevronDown, type Globe2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { DraftErrors, PlanDraft, TickerDraft } from "./plan-draft";
import { gpI18n } from "@/i18n/ns/gamePlan";

export type SetDraft = (fn: (d: PlanDraft) => PlanDraft) => void;

/** Ticker suggestion from another source (watchlist, desk plan). */
export type TickerSuggestion = Partial<TickerDraft> & { ticker: string };

/* ── Pieces of the plan editor (block shell, labelled field, index levels) ───── */
export function Block({
  id,
  icon: Icon,
  title,
  hint,
  actions,
  children,
  pasteKey,
}: {
  id: string;
  icon: typeof Globe2;
  title: string;
  hint?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  pasteKey?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-16 flex flex-col gap-3" data-paste-target={pasteKey}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary">
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 id={`${id}-h`} className="text-sm font-semibold leading-tight">
              {title}
            </h3>
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function Field({
  label,
  htmlFor,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      {children}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** SPY / QQQ support–resistance levels inside «Рынок»; collapsed until filled. */
export function IndexLevels({
  uid,
  draft,
  errors,
  patch,
}: {
  uid: string;
  draft: PlanDraft;
  errors: DraftErrors;
  patch: (p: Partial<PlanDraft>) => void;
}) {
  const { t: tr } = gpI18n.useT();
  const [showIdx, setShowIdx] = useState(() => !!(draft.spyS || draft.spyR || draft.qqqS || draft.qqqR || draft.spyNote || draft.qqqNote));
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setShowIdx((v) => !v)}
        aria-expanded={showIdx}
        className="inline-flex w-fit items-center gap-1.5 rounded-full text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !showIdx && "-rotate-90")} aria-hidden="true" />
        {tr("editor.indexLevels")}
        {(draft.spyS || draft.spyR || draft.qqqS || draft.qqqR) && !showIdx && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />}
      </button>
      {showIdx && (
        <div className="grid gap-3 md:grid-cols-2">
          {(["spy", "qqq"] as const).map((sym) => {
            const S = sym === "spy" ? "spyS" : "qqqS";
            const R = sym === "spy" ? "spyR" : "qqqR";
            const N = sym === "spy" ? "spyNote" : "qqqNote";
            return (
              <div key={sym} className="flex flex-col gap-2 rounded-xl border border-[var(--field-border)] p-3">
                <p className="text-sm font-semibold">{sym.toUpperCase()}</p>
                <div className="grid grid-cols-2 gap-2">
                  <Field label={tr("editor.support")} htmlFor={`${uid}-${S}`} error={errors[S]}>
                    <Input id={`${uid}-${S}`} inputMode="decimal" placeholder="578.2 575" value={draft[S]} onChange={(e) => patch({ [S]: e.target.value } as Partial<PlanDraft>)} />
                  </Field>
                  <Field label={tr("editor.resistance")} htmlFor={`${uid}-${R}`} error={errors[R]}>
                    <Input id={`${uid}-${R}`} inputMode="decimal" placeholder="583.5 586" value={draft[R]} onChange={(e) => patch({ [R]: e.target.value } as Partial<PlanDraft>)} />
                  </Field>
                </div>
                <Input
                  aria-label={tr("editor.indexComment", { symbol: sym.toUpperCase() })}
                  placeholder={tr("editor.indexCommentPlaceholder")}
                  maxLength={500}
                  value={draft[N]}
                  onChange={(e) => patch({ [N]: e.target.value } as Partial<PlanDraft>)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
