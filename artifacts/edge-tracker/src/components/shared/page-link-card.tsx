/**
 * A link card instead of a second copy (design audit, wave 2B): where a block of one page is the whole job of another
 * (the period report of /analytics «Обзор» is /stats, the analytics «Что если» is /what-if, the psychology tab's
 * behaviour block is /behavior), the page shows one row that says what is there and opens it with the same filters
 * (period, trader, …) — `scope` names them, so the reader knows the other page will show the same slice.
 */
import { Link } from "wouter";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageLinkCard({ href, icon: Icon, title, description, scope, className }: {
  href: string;
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** The filters carried over, e.g. «90 дней · Мои сделки». */
  scope?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "glass-panel group flex min-h-14 items-center gap-3 rounded-2xl px-[var(--panel-p)] py-3 text-left transition-colors duration-[var(--dur-1)] hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        {(description || scope) && (
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {[description, scope].filter(Boolean).join(" · ")}
          </span>
        )}
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-[var(--dur-1)] group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none" aria-hidden="true" />
    </Link>
  );
}
