/**
 * «Первые шаги» — a small collapsible card under the dashboard hero for people who are still new (lib/onboarding:
 * stage «new» or an admin reset). Every tick comes from real data (GET /api/users/me/onboarding signals + what the web
 * noticed: the first trade card, the playbook) — nothing is ticked by hand. Collapsed by default to one quiet line with
 * the next step; gone for good once every step is done or «Скрыть» is pressed.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { links } from "@/lib/links";
import { useAppearance } from "@/contexts/appearance-context";
import { onboardingI18n } from "@/i18n/ns/onboarding";
import { checklistItems, shouldShowChecklist, type ChecklistId, type ChecklistItem } from "@/lib/onboarding/model";
import { dismissChecklist, refreshOnboardingStatus, useOnboarding } from "@/lib/onboarding/store";

const OPEN_KEY = "ws_lexx_first_steps_open";

function readOpen(): boolean {
  try { return localStorage.getItem(OPEN_KEY) === "1"; } catch { return false; }
}

function hrefOf(id: ChecklistId): string | null {
  switch (id) {
    case "secret":
    case "quickCode": return "/settings#profile";
    case "telegram": return "/settings#integrations";
    case "plan": return links.myPlan();
    case "closeDay": return "/journal";
    case "trade": return "/trades";
    case "playbook": return "/playbook";
    case "look": return null;
  }
}

export function FirstSteps({ className }: { className?: string }) {
  const ob = useOnboarding();
  const { t } = onboardingI18n.useT();
  const { openAppearance } = useAppearance();
  const [open, setOpen] = useState(readOpen);

  // Signals can change elsewhere (Telegram linked in another tab, «Вид» saved): re-read on mount and on focus.
  useEffect(() => {
    refreshOnboardingStatus();
    const onFocus = () => refreshOnboardingStatus();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const signals = ob.status?.signals ?? null;
  const items = checklistItems(signals, ob.state);
  const input = { mode: ob.mode, stage: ob.status?.stage ?? null, state: ob.state, items, hasSignals: !!signals };
  const show = ob.ready && shouldShowChecklist(input);
  const allDone = !!signals && items.every((i) => i.done);
  const newcomer = ob.ready && !!signals && ob.mode === "auto" && ob.state.checklist == null && (ob.status?.stage === "new" || ob.state.again === true);

  // Closure: the last tick retires the card for good.
  useEffect(() => { if (newcomer && allDone) dismissChecklist("done"); }, [newcomer, allDone]);

  if (!show) return null;
  const done = items.filter((i) => i.done).length;
  const nextItem = items.find((i) => !i.done) ?? null;
  const toggle = () => {
    const v = !open;
    setOpen(v);
    try { localStorage.setItem(OPEN_KEY, v ? "1" : "0"); } catch { /* storage unavailable */ }
  };

  return (
    <section aria-labelledby="first-steps-title" className={cn("glass-panel rounded-2xl px-4 py-3 print:hidden", className)}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls="first-steps-list"
          aria-label={open ? t("checklist.collapse") : t("checklist.expand")}
          className="-m-1 flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Ring done={done} total={items.length} />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span id="first-steps-title" className="text-sm font-semibold text-foreground">{t("checklist.title")}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{t("checklist.progress", { done, total: items.length })}</span>
            </span>
            {!open && nextItem && <span className="block truncate text-xs text-muted-foreground">{t(`checklist.items.${nextItem.id}.label`)}</span>}
          </span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-[var(--dur-2)] motion-reduce:transition-none", open && "rotate-180")} aria-hidden="true" />
        </button>
        <Button variant="ghost" size="sm" className="shrink-0 text-muted-foreground" onClick={() => dismissChecklist("dismissed")} aria-label={t("checklist.hideAria")}>
          {t("checklist.hide")}
        </Button>
      </div>
      {open && (
        <div id="first-steps-list" className="mt-3 border-t border-[var(--glass-border)] pt-2">
          <ul className="grid gap-x-6 sm:grid-cols-2">
            {items.map((it) => <Row key={it.id} item={it} onLook={() => openAppearance("themes")} />)}
          </ul>
          <p className="mt-2 text-2xs text-muted-foreground">{t("checklist.hint")}</p>
        </div>
      )}
    </section>
  );
}

function Ring({ done, total }: { done: number; total: number }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative grid h-9 w-9 shrink-0 place-items-center" aria-hidden="true">
      <svg viewBox="0 0 36 36" className="h-9 w-9 -rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3" className="stroke-muted-foreground/20" />
        <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(done / Math.max(1, total)) * c} ${c}`} className="stroke-primary transition-[stroke-dasharray] duration-[var(--dur-3)] motion-reduce:transition-none" />
      </svg>
      <span className="absolute text-2xs font-semibold tabular-nums text-foreground">{done}</span>
    </span>
  );
}

function Row({ item, onLook }: { item: ChecklistItem; onLook: () => void }) {
  const { t } = onboardingI18n.useT();
  const label = t(`checklist.items.${item.id}.label`);
  const hint = t(`checklist.items.${item.id}.hint`);
  const mark = (
    <span
      className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border", item.done ? "border-transparent bg-primary text-primary-foreground" : "border-[var(--field-border)]")}
      role="img"
      aria-label={item.done ? t("checklist.doneAria") : t("checklist.todoAria")}
    >
      {item.done && <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />}
    </span>
  );
  const text = (
    <span className="min-w-0 flex-1">
      <span className={cn("block text-sm", item.done ? "text-muted-foreground" : "font-medium text-foreground")}>{label}</span>
      <span className="block text-xs text-muted-foreground">{hint}</span>
    </span>
  );
  const rowCls = "flex items-start gap-3 rounded-xl px-2 py-2";
  if (item.done) return <li className={rowCls}>{mark}{text}</li>;
  const href = hrefOf(item.id);
  const actCls = cn(rowCls, "w-full text-left transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring");
  const arrow = <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
  return (
    <li>
      {href ? (
        <Link href={href} className={actCls}>{mark}{text}{arrow}</Link>
      ) : (
        <button type="button" onClick={onLook} className={actCls}>{mark}{text}{arrow}</button>
      )}
    </li>
  );
}
