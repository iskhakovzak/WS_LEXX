/** Small building blocks of the «Вид» dialog: sections, colour swatches, the custom picker, contrast notes. */
import * as React from "react";
import { Check, Pipette, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { rgbToHex, type GuardResult } from "@/lib/appearance/color";
import { appearanceI18n } from "@/i18n/ns/appearance";

export function Section({ title, hint, children, aside }: { title: string; hint?: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 border-t border-[var(--glass-border)] pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={id} className="text-sm font-semibold text-foreground">{title}</h3>
          {hint && <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">{hint}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** One colour swatch in a radio group (32px dot, 40px hit area, ring + check when selected). */
export function Swatch({
  color,
  label,
  selected,
  onSelect,
  children,
}: {
  /** Any CSS colour; omitted for content swatches (children). */
  color?: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      onClick={onSelect}
      className={cn(
        "press relative grid h-10 w-10 shrink-0 place-items-center rounded-full transition-shadow duration-[var(--dur-1)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        selected && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
      )}
    >
      <span
        aria-hidden="true"
        className="grid h-8 w-8 place-items-center overflow-hidden rounded-full border border-[var(--field-border)]"
        style={color ? { background: color } : undefined}
      >
        {children}
      </span>
      {selected && (
        <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 grid h-4 w-4 place-items-center rounded-full bg-foreground text-background">
          <Check className="h-2.5 w-2.5" strokeWidth={3} />
        </span>
      )}
    </button>
  );
}

/** Radio group wrapper with arrow-key roving between swatches. */
export function SwatchGroup({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  function onKeyDown(e: React.KeyboardEvent) {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("[role=radio]") ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    const next = items[(i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
    next.focus();
    next.click();
  }
  return (
    <div ref={ref} role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {children}
    </div>
  );
}

/** Custom colour: a rainbow swatch over a native colour input (keyboard and screen-reader friendly). */
export function CustomSwatch({ value, selected, label, onPick }: { value: string | null; selected: boolean; label: string; onPick: (hex: string) => void }) {
  const id = React.useId();
  return (
    <label
      htmlFor={id}
      title={label}
      className={cn(
        "press relative grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full",
        "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
        selected && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
      )}
    >
      <span
        aria-hidden="true"
        className="grid h-8 w-8 place-items-center rounded-full border border-[var(--field-border)]"
        style={{ background: selected && value ? value : "conic-gradient(from 90deg, #ef4444, #f59e0b, #84cc16, #14b8a6, #3b82f6, #a855f7, #ef4444)" }}
      >
        <Pipette className="h-3.5 w-3.5 text-white mix-blend-difference" />
      </span>
      <input
        id={id}
        type="color"
        aria-label={label}
        value={value ?? "#3b82f6"}
        onChange={(e) => onPick(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </label>
  );
}

/** «Adjusted for AA contrast» line under a colour control, with the colour actually used. */
export function GuardNote({ result }: { result: GuardResult | undefined }) {
  const { t } = appearanceI18n.useT();
  if (!result?.adjusted) return null;
  const ratio = result.ratio.toFixed(1);
  return (
    <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
      <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0 rounded-full border border-[var(--field-border)]" style={{ background: rgbToHex(result.rgb) }} />
      <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {result.ok ? t("colors.adjusted", { ratio }) : t("colors.refused", { ratio })}
    </p>
  );
}

/** Big selectable card (theme tiles, fonts, densities, backgrounds). */
export function OptionCard({
  selected,
  onSelect,
  label,
  children,
  className,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      onClick={onSelect}
      className={cn(
        "lift group relative flex flex-col gap-2 rounded-2xl border p-2 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        selected ? "border-foreground/70 bg-[var(--glass-hover-bg)]" : "border-[var(--glass-border)] hover:bg-[var(--glass-hover-bg)]",
        className,
      )}
    >
      {children}
      <span
        aria-hidden="true"
        className={cn(
          "absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full border",
          selected ? "border-transparent bg-foreground text-background" : "border-[var(--field-border)] bg-[var(--glass-thick-bg)] opacity-0 group-hover:opacity-100",
        )}
      >
        {selected && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
    </button>
  );
}
