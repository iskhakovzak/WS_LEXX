/**
 * Empty state — one component for every «nothing here yet» (mobile-empty wave):
 *
 *   ┌───────────────┐
 *   │  (engraving)  │  a small monochrome engraved medallion (empty-art.tsx), the section's icon as a seal on it
 *   │ One-line text │  what is missing, in one line
 *   │  description  │  optional: why / how to fix it (kept from the old states)
 *   │ [ Primary ]   │  exactly one primary action
 *   │  secondary →  │  optional quieter link
 *   └───────────────┘
 *
 * `compact` (small panels / tiles): one row — the icon tile, the text, the action — no medallion.
 * `art` picks the motif by meaning (column = a page / overview, amphora = trades and setups, scroll = journal and
 * notes, scales = risk, laurel = progress and learning, temple = the desk and the team).
 */
import * as React from "react";
import { Link } from "wouter";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EngravedArt, type EmptyArt } from "@/components/ds/empty-art";

export type { EmptyArt } from "@/components/ds/empty-art";

/** The primary action of an empty state as a link to another screen (a Button styled as the main call to action). */
export function EmptyLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Button asChild><Link href={href}>{children}</Link></Button>;
}

export type EmptyChoice ={ label: React.ReactNode; run: () => void };

/**
 * Several possible ways out of an empty state (show all time · whole team · all horizons) → exactly one primary
 * button (the first that applies) and the rest as quiet text buttons. Spread into <EmptyState {...emptyActions([…])} />.
 */
export function emptyActions(choices: (EmptyChoice | false | null | undefined)[]): { action?: React.ReactNode; secondaryAction?: React.ReactNode } {
  const [first, ...rest] = choices.filter((c): c is EmptyChoice => !!c);
  if (!first) return {};
  return {
    action: <Button onClick={first.run}>{first.label}</Button>,
    secondaryAction: rest.length ? (
      <span className="flex flex-wrap justify-center gap-x-1">
        {rest.map((c, i) => <Button key={i} variant="link" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={c.run}>{c.label}</Button>)}
      </span>
    ) : undefined,
  };
}

export function EmptyState({
  icon: Icon,
  art = "column",
  title,
  description,
  action,
  className,
  secondaryAction,
  compact = false,
}: {
  icon?: LucideIcon;
  /** Engraved motif of the full state (default: the column). */
  art?: EmptyArt;
  /** The one-line message. */
  title: React.ReactNode;
  description?: React.ReactNode;
  /** The one primary action (a Button). */
  action?: React.ReactNode;
  className?: string;
  /** Optional quieter link / ghost button next to the primary action. */
  secondaryAction?: React.ReactNode;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div data-empty-state="compact" className={cn("flex flex-wrap items-center gap-3 px-1 py-4 text-left", className)}>
        {Icon && (
          <span className="tile grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted-foreground">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-[12rem] flex-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {(action || secondaryAction) && (
          <div className="flex shrink-0 items-center gap-2">
            {secondaryAction}
            {action}
          </div>
        )}
      </div>
    );
  }
  return (
    <div data-empty-state="full" className={cn("flex flex-col items-center justify-center gap-3 px-6 py-10 text-center", className)}>
      <div className="relative text-muted-foreground">
        <EngravedArt art={art} size={88} />
        {Icon && (
          <span className="absolute -bottom-0.5 -right-1 grid h-7 w-7 place-items-center rounded-full border border-[var(--glass-border)] bg-background text-foreground/80 shadow-[0_0_0_3px_hsl(var(--background))]">
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        )}
      </div>
      <div className="max-w-sm">
        <p className="text-balance text-sm font-semibold text-foreground">{title}</p>
        {description && <p className="mt-1 text-pretty text-sm text-muted-foreground">{description}</p>}
      </div>
      {(action || secondaryAction) && (
        <div className="mt-1 flex flex-col items-center gap-1.5">
          {action}
          {secondaryAction && <div className="text-xs text-muted-foreground [&_a]:underline-offset-4 [&_a:hover]:underline">{secondaryAction}</div>}
        </div>
      )}
    </div>
  );
}
