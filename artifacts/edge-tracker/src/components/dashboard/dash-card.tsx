/**
 * One visual language for the dashboard (owner, 2026-10-25: «всё вразнобой»): every card is the insight tile's glass
 * shell (components/insight-tiles: .ins-tile = .glass-panel + specular rim + soft top light, the same radius and
 * padding) with the tile's sentence-case label as its header. So «Вид» panels / scenes apply the same way to the hero,
 * the plan, the curve, the trades and the bento. `SectionHead` is the section heading above each section.
 * The tile shell's stylesheet (insight-tiles.css) comes with the page (pages/dashboard.tsx) — features do not import
 * each other.
 */
import { useId, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { HelpScope, ScopedHelp } from "@/components/shared/tool-help";
import "./dashboard.css";

export function DashCard({
  title,
  description,
  actions,
  footer,
  children,
  className,
  bodyClassName,
  fill = false,
  ...rest
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Bottom bar (links, totals) with a hairline above it. */
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Stretch to the grid row (equal heights side by side). */
  fill?: boolean;
} & Omit<HTMLAttributes<HTMLElement>, "title">) {
  const id = useId();
  // The «?» of the tile this card is (the board sets the scope); cards nested inside draw none.
  return (
    <section aria-labelledby={title ? id : undefined} className={cn("ins-tile glass-panel dash-card", fill && "h-full", className)} {...rest}>
      {(title || actions) && (
        <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <div className="flex min-w-0 items-center gap-1">
            <div className="min-w-0">
              {title && <h3 id={id} className="ins-label truncate">{title}</h3>}
              {description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{description}</p>}
            </div>
            {title && <ScopedHelp className="self-start" />}
          </div>
          {actions && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-1.5">{actions}</div>}
        </div>
      )}
      <HelpScope id={null}>
        <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", bodyClassName)}>{children}</div>
        {footer && <div className="dash-card-foot">{footer}</div>}
      </HelpScope>
    </section>
  );
}

/** The heading of a dashboard section (+ an optional quiet line and a right-side control). */
export function SectionHead({ id, title, hint, action }: { id: string; title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="dash-section-head">
      <h2 id={id} className="ins-label">
        {title}
        {hint && <span className="dash-section-hint">{hint}</span>}
      </h2>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

/** A labelled dashboard section: the label, then its content with the one inner gap. */
export function DashSection({ id, title, hint, action, children, className }: { id: string; title: ReactNode; hint?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  const headId = `${id}-head`;
  return (
    <section aria-labelledby={headId} className={cn("dash-section", className)}>
      <SectionHead id={headId} title={title} hint={hint} action={action} />
      {children}
    </section>
  );
}
