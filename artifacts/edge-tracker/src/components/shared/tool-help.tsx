/**
 * «?» — what a tool is and why it exists (owner, 2026-10-30). A small round button that opens a popover with the
 * tool's registry entry (lib/help/registry, texts in the `help` namespace): what it is, why (the idea), how to read
 * it, an example with numbers, and where it leads next in the day. The same texts feed the tour and «Справочник».
 *
 *   <ToolHelp id="riskSignals" />                       — explicit, on a card or a panel's actions
 *   <HelpScope id="equity">…<ScopedHelp />…</HelpScope>  — a frame (DashCard, a tile head, WidgetShell) draws the «?»
 *                                                         of the tool it is placed in (the dashboard board sets it)
 * The trigger is a real button (Tab, Enter / Space; Esc closes the popover and focus returns), sized so a title row
 * never grows; the popover floats over the page (no layout shift). The shell provides who is looking
 * (`HelpAccessProvider`, components/layout.tsx), so a «Дальше» link never points at a closed or staff-only section.
 */
import * as React from "react";
import { Link } from "wouter";
import { ArrowRight, CircleHelp } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { helpI18n } from "@/i18n/ns/help";
import { shellI18n } from "@/i18n/ns/shell";
import { HELP, isWidget, nextFor, type HelpId, type HelpViewer } from "@/lib/help/registry";

const OPEN_ALL: HelpViewer = { isCurator: false, tier: null, canOpen: () => true };
const AccessContext = React.createContext<HelpViewer>(OPEN_ALL);
/** The shell's viewer (role, tier, which sections are open), read by every «?» and the guide. */
export const HelpAccessProvider = AccessContext.Provider;
export function useHelpViewer(): HelpViewer {
  return React.useContext(AccessContext);
}

/** The tool's name in the current language: a page's nav label, a card's help title. Call during render. */
export function helpTitle(id: HelpId): string {
  return isWidget(id) ? helpI18n.t(`titles.${id}`) : shellI18n.t(`nav.${id}`);
}

/** The four lines of an entry, in the current language (the popover, the tour card, the guide and its search). */
export function helpText(id: HelpId): { what: string; why: string; read: string; example: string } {
  return {
    what: helpI18n.t(`entries.${id}.what`),
    why: helpI18n.t(`entries.${id}.why`),
    read: helpI18n.t(`entries.${id}.read`),
    example: helpI18n.t(`entries.${id}.example`),
  };
}

const ScopeContext = React.createContext<HelpId | null>(null);

/** Marks the tool a frame belongs to; `null` stops a parent's scope (a card inside a card draws no second «?»). */
export function HelpScope({ id, children }: { id: HelpId | null | undefined; children: React.ReactNode }) {
  return <ScopeContext.Provider value={id ?? null}>{children}</ScopeContext.Provider>;
}

/** The «?» of the surrounding scope (nothing outside one — the same card on another page stays as it was). */
export function ScopedHelp({ className }: { className?: string }) {
  const id = React.useContext(ScopeContext);
  return id ? <ToolHelp id={id} className={className} /> : null;
}

export function ToolHelp({ id, size = "sm", className, align = "end" }: {
  id: HelpId;
  /** sm — a card's title row (24 px); md — a page header (36 px, like the header's other icon buttons). */
  size?: "sm" | "md";
  className?: string;
  align?: "start" | "center" | "end";
}) {
  const { t } = helpI18n.useT();
  shellI18n.useT();
  const viewer = useHelpViewer();
  const [open, setOpen] = React.useState(false);
  const title = helpTitle(id);
  const text = helpText(id);
  const entry = HELP[id];
  const next = nextFor(id, viewer).slice(0, 2);
  const bodyId = React.useId();
  const close = () => setOpen(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("ui.aria", { title })}
          title={t("ui.button")}
          data-help-id={id}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "grid shrink-0 place-items-center rounded-full text-muted-foreground/80 transition-colors hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-[var(--glass-hover-bg)] data-[state=open]:text-foreground print:hidden",
            size === "md" ? "h-9 w-9" : "-my-1 h-6 w-6",
            className,
          )}
        >
          <CircleHelp className={size === "md" ? "h-4 w-4" : "h-3.5 w-3.5"} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} aria-describedby={bodyId} className="w-[min(23rem,calc(100vw-1.5rem))] p-0" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-2.5 px-4 pb-3 pt-3.5">
          <div>
            <p className="text-2xs font-medium text-muted-foreground">{t(`phases.${entry.phase}.label`)}</p>
            <h3 className="mt-0.5 text-sm font-semibold leading-snug text-foreground">{title}</h3>
            <p id={bodyId} className="mt-1 text-sm leading-relaxed text-foreground/90">{text.what}</p>
          </div>
          <dl className="space-y-2 text-[0.8125rem] leading-relaxed">
            <Line label={t("ui.why")} value={text.why} />
            <Line label={t("ui.read")} value={text.read} />
            <Line label={t("ui.example")} value={text.example} mono />
          </dl>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-[var(--glass-border)] px-4 py-2.5 text-xs">
          {next.length > 0 && <span className="text-muted-foreground">{t("ui.next")}:</span>}
          {next.map((n) => (
            <Link key={n} href={HELP[n].href} onClick={close} className="rounded-md font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {helpTitle(n)}
            </Link>
          ))}
          <Link href={`/guide#${id}`} onClick={close} className="ml-auto inline-flex items-center gap-1 rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("ui.guide")}
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Line({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-2xs font-medium text-muted-foreground">{label}</dt>
      <dd className={cn("text-foreground/85", mono && "tabular-nums")}>{value}</dd>
    </div>
  );
}
