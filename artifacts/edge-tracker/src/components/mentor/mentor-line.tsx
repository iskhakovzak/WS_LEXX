/**
 * «Ментор: …» — one line in the trader's daily flow (dashboard tile, the plan page): today's rule, else the weakest
 * commitment's score, else the next step of the rhythm. No model call (GET /api/mentor/line); the whole line opens /coach.
 */
import { Link } from "wouter";
import { ChevronRight, Compass } from "lucide-react";
import { mentorI18n } from "@/i18n/ns/mentor";
import { useMentorLine } from "./api";
import { lineText } from "./model";

export function MentorLine({ className = "" }: { className?: string }) {
  const { t } = mentorI18n.useT();
  const q = useMentorLine();
  if (!q.data?.enabled) return null;
  return (
    <Link
      href="/coach"
      aria-label={t("line.open")}
      className={`group flex min-h-11 min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
    >
      <Compass className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="shrink-0 font-semibold text-foreground">{t("line.label")}:</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{lineText(q.data)}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}
