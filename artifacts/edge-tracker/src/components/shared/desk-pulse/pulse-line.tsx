/**
 * The one desk-pulse line of the morning brief («в этом сезоне: X — работает; Y — не работает»), stored with the brief
 * digest as codes (api lib/mentor applyRhythm → lib/deskPulse), rendered here in the viewer's language; links to the
 * whole matrix on Big7 (connectedness).
 */
import { Link } from "wouter";
import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { deskPulseI18n } from "@/i18n/ns/deskPulse";
import { pulseLine, type PulseHighlight } from "./api";

export function PulseLine({ pulse, className }: { pulse: { works: PulseHighlight | null; fails: PulseHighlight | null } | null | undefined; className?: string }) {
  const { t } = deskPulseI18n.useT();
  const line = pulseLine(pulse);
  if (!line) return null;
  return (
    <p className={cn("flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-foreground", className)}>
      <Activity className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span>{line}</span>
      <Link href="/big7" className="text-xs text-muted-foreground underline-offset-2 hover:underline">{t("pulse.title")}</Link>
    </p>
  );
}
