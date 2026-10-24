/**
 * Building blocks of the command palette list: a row (icon, highlighted title, subtitle, badge, shortcut hint), a group
 * with a heading, a badge and the footer with the keyboard hints. Texts: shell `palette.*`.
 */
import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { CornerDownLeft } from "lucide-react";
import { Kbd } from "@/components/ds";
import { Highlight } from "@/components/people/highlight";
import { shellI18n } from "@/i18n/ns/shell";
import { cn } from "@/lib/utils";
import type { Range } from "./rank";

export type BadgeTone = "up" | "down" | "warn" | "neutral" | "accent";

const BADGE_TONE: Record<BadgeTone, string> = {
  up: "bg-up/15 text-up",
  down: "bg-down/15 text-down",
  warn: "bg-[hsl(var(--chart-3)/0.15)] text-[hsl(var(--chart-3))]",
  accent: "bg-primary/15 text-primary",
  neutral: "bg-[var(--glass-bg)] text-muted-foreground",
};

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: BadgeTone }) {
  return <span className={cn("rounded-full px-2 py-0.5 text-2xs font-medium tabular-nums", BADGE_TONE[tone])}>{children}</span>;
}

/** Text with the matched characters marked (no ranges: plain text). */
export function Hl({ text, ranges }: { text: string; ranges?: readonly Range[] | null }) {
  return <Highlight text={text} ranges={ranges} />;
}

export function Item({
  value,
  onSelect,
  icon: Icon,
  title,
  subtitle,
  right,
  hint,
  className,
}: {
  value: string;
  onSelect: () => void;
  icon?: React.ElementType;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  /** Keys of the global shortcut that does the same (e.g. ["G", "P"]); shown on wider screens. */
  hint?: readonly string[];
  className?: string;
}) {
  return (
    <CommandPrimitive.Item
      value={value}
      onSelect={onSelect}
      className={cn(
        "group flex min-h-10 cursor-pointer select-none items-center gap-3 rounded-xl px-2.5 py-2 text-sm outline-none",
        "data-[selected=true]:bg-primary/12 data-[selected=true]:text-foreground",
        className,
      )}
    >
      {Icon && (
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted-foreground group-data-[selected=true]:text-primary">
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground">{title}</span>
        {subtitle && <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>}
      </span>
      {right}
      {hint && hint.length > 0 && <Kbd keys={[...hint]} className="hidden shrink-0 sm:inline-flex" />}
      <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-data-[selected=true]:opacity-100" aria-hidden="true" />
    </CommandPrimitive.Item>
  );
}

const groupCls =
  "px-1.5 pb-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground";

export function Group({ heading, children }: { heading: React.ReactNode; children: React.ReactNode }) {
  return <CommandPrimitive.Group heading={heading} className={groupCls}>{children}</CommandPrimitive.Group>;
}

/** Badge + date on the right of a data row. */
export function RowMeta({ badge, tone, meta }: { badge?: string; tone?: BadgeTone; meta?: string }) {
  if (!badge && !meta) return null;
  return (
    <span className="flex shrink-0 items-center gap-2">
      {badge && <Badge tone={tone}>{badge}</Badge>}
      {meta && <span className="hidden text-2xs tabular-nums text-muted-foreground sm:inline">{meta}</span>}
    </span>
  );
}

/** Keyboard hints under the list (hidden on phones, where there is no keyboard). */
export function PaletteFooter() {
  const { t } = shellI18n.useT();
  return (
    <div aria-hidden="true" className="hidden flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--glass-border)] px-4 py-2 text-2xs text-muted-foreground sm:flex">
      <span className="inline-flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> {t("palette.footerSelect")}</span>
      <span className="inline-flex items-center gap-1"><Kbd>↵</Kbd> {t("palette.footerOpen")}</span>
      <span className="inline-flex items-center gap-1"><Kbd>Tab</Kbd> {t("palette.footerGroups")}</span>
      <span className="inline-flex items-center gap-1"><Kbd>$</Kbd> {t("palette.footerTicker")}</span>
      <span className="inline-flex items-center gap-1"><Kbd>#</Kbd> {t("palette.footerTradeId")}</span>
      <span className="inline-flex items-center gap-1"><Kbd>G</Kbd> {t("palette.footerGo")}</span>
    </div>
  );
}
