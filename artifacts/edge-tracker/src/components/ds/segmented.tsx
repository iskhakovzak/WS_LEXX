/**
 * Segmented control: a glass pill track whose active option sits on a solid pill that slides from option to option
 * (ui/active-pill, framer layoutId). Single-select; a phone-width bar scrolls sideways and keeps the active option in
 * view.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { fmtCount } from "@/lib/format";
import { ActivePill } from "@/components/ui/active-pill";
import { useScrollActiveIntoView } from "@/components/ds/scroll-active";
import { useEdgeFade } from "@/components/ds/edge-fade";

export type SegmentOption<T extends string> = { value: T; label: React.ReactNode; count?: number; disabled?: boolean; /** Native tooltip (e.g. why the option is disabled). */ title?: string };

/**
 * Segmented control: pill track, active segment on the neutral «selected» fill. Single-select. For filters and modes
 * only; the views of a page are SectionTabs.
 *
 * `T` is inferred from `value` only (options/onChange are `NoInfer`), so
 * `<Segmented value={tab} onChange={setTab} options={...} />` works with a
 * `useState<"a" | "b">` setter even when the options array is typed loosely.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = "md",
  className,
}: {
  options: ReadonlyArray<SegmentOption<NoInfer<T>>> | ReadonlyArray<SegmentOption<string>>;
  value: T;
  onChange: (v: NoInfer<T>) => void;
  ariaLabel: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const pill = `segmented-pill-${React.useId()}`;
  useScrollActiveIntoView(ref, value); // a phone-width bar scrolls sideways: keep the active option visible
  useEdgeFade(ref); // …and fade the edge that hides more options
  return (
    <div
      ref={ref}
      role="group"
      aria-label={ariaLabel}
      // Touch: the track grows to 40 / 44 px so each segment's 44 px hit area (index.css ::before) fits inside it;
      // overflow-y-hidden keeps that extender from making the sideways scroller wobble vertically.
      className={cn("glass-field edge-fade scrollbar-none relative inline-flex max-w-full shrink-0 items-center gap-0.5 overflow-x-auto overflow-y-hidden", size === "sm" ? "h-8 p-0.5 pointer-coarse:h-10" : "h-9 p-[3px] pointer-coarse:h-11", className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onChange(o.value as T)}
            className={cn(
              "press relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-medium transition-[background-color,color,box-shadow,transform] duration-[var(--dur-1)] ease-smooth disabled:opacity-50",
              size === "sm" ? "h-6.5 px-2.5 text-xs [&_svg]:size-3.5 pointer-coarse:h-8.5" : "h-7 px-3 text-sm [&_svg]:size-4 pointer-coarse:h-9",
              active ? "text-selected-foreground" : "text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground",
            )}
          >
            {active && <ActivePill layoutId={pill} />}
            <span className="relative inline-flex items-center gap-1.5">
              {o.label}
              {o.count != null && <span className={cn("tabular-nums", active ? "opacity-90" : "opacity-80")}>{fmtCount(o.count)}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
