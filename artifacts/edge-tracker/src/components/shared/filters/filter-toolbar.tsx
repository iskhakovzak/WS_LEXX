/**
 * The ONE filter pattern of every list / analytics screen (design audit wave 3):
 *
 *   PageHeader
 *   Toolbar   [ search ]  [ one Segmented: the main mode ]  [ scope: period · person ]  [ Фильтры (n) ]   …end
 *   chips     NVDA ×   Лонг ×   Без IMX ×   Сбросить
 *
 * - `Toolbar` (components/ds) is the row; it sits directly under the PageHeader, never inside the header.
 * - `ToolbarSearch`: the screen's only search box («/» focuses it, Esc clears). A screen never has two.
 * - `FiltersButton`: everything that is not the main mode or the scope. A popover under the button on desktop, a
 *   bottom sheet on phones; the badge counts what is active. Group fields with `FilterSection`.
 * - `ActiveFilters`: each active filter as a removable chip + «Сбросить»; renders nothing when nothing is active.
 *   Every value hidden in the popover must have a chip here, so the list never looks unfiltered when it is not.
 */
import * as React from "react";
import { RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn, isTypingTarget } from "@/lib/utils";
import { commonI18n } from "@/i18n/ns/common";

// ── Search ───────────────────────────────────────────────────────────────────

export function ToolbarSearch({
  value,
  onChange,
  placeholder,
  ariaLabel,
  inputRef,
  hotkey = true,
  className,
  onKeyDown,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  /** «/» anywhere on the page focuses the box (off when the page binds «/» itself). */
  hotkey?: boolean;
  className?: string;
  /** Extra keys (↓ / Enter into a result list); Esc already clears and blurs. */
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const t = commonI18n.t;
  const own = React.useRef<HTMLInputElement | null>(null);
  const setRef = (el: HTMLInputElement | null) => {
    own.current = el;
    if (typeof inputRef === "function") inputRef(el);
    else if (inputRef) (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
  };
  React.useEffect(() => {
    if (!hotkey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      e.preventDefault();
      own.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkey]);
  return (
    <div role="search" className={cn("relative min-w-0 flex-1 basis-48", className)}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        ref={setRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            if (value) onChange("");
            else (e.target as HTMLInputElement).blur();
          }
          onKeyDown?.(e);
        }}
        aria-label={ariaLabel ?? placeholder ?? t("filters.search")}
        placeholder={placeholder ?? t("filters.search")}
        className="h-9 pl-10 pr-10 [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          aria-label={t("filters.clear")}
          onClick={() => { onChange(""); own.current?.focus(); }}
          className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : hotkey ? (
        <Kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 md:inline-flex">/</Kbd>
      ) : null}
    </div>
  );
}

// ── «Фильтры (n)» ────────────────────────────────────────────────────────────

export function FiltersButton({
  count,
  children,
  onReset,
  width = "md",
  label,
  description,
  resultCount,
  className,
  open: openProp,
  onOpenChange,
}: {
  /** Active filters inside (the badge); 0 hides it. */
  count: number;
  children: React.ReactNode;
  /** «Сбросить» in the footer (shown while count > 0). */
  onReset?: () => void;
  /** md ≈ 380 px, lg ≈ 560 px, xl ≈ 860 px (a grid of columns, e.g. the trade «Разрезы»). */
  width?: "md" | "lg" | "xl";
  /** Button text (default «Фильтры»). */
  label?: string;
  /** One line under the sheet title on phones. */
  description?: string;
  /** Rows the filters leave, for the phone sheet's «Показать: N». */
  resultCount?: number;
  className?: string;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  const t = commonI18n.t;
  const isMobile = useIsMobile();
  const [ownOpen, setOwnOpen] = React.useState(false);
  const open = openProp ?? ownOpen;
  const setOwn = onOpenChange ?? setOwnOpen;
  // The popover grows away from the nearer screen edge: a button on the left of the toolbar opens to the right
  // (align start), one at the end of the row opens to the left — a wide panel never slides over the sidebar.
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const [align, setAlign] = React.useState<"start" | "end">("end");
  const setOpen = (o: boolean) => {
    if (o && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setAlign(r.left + r.width / 2 < window.innerWidth / 2 ? "start" : "end");
    }
    setOwn(o);
  };
  const text = label ?? t("filters.button");
  const trigger = (
    <Button
      ref={triggerRef}
      type="button"
      variant="outline"
      size="sm"
      aria-label={count > 0 ? t("filters.buttonAriaActive", { count }) : t("filters.buttonAria")}
      aria-expanded={open}
      className={cn("h-9 shrink-0 gap-1.5", count > 0 && "border-primary/40", className)}
    >
      <SlidersHorizontal aria-hidden="true" />
      {text}
      {count > 0 && <span className="min-w-5 rounded-full bg-primary-solid px-1.5 text-xs font-semibold leading-5 tabular-nums text-primary-foreground">{count}</span>}
    </Button>
  );
  const reset = onReset && count > 0 ? (
    <Button type="button" variant="ghost" size="sm" onClick={onReset} className="gap-1.5 text-muted-foreground">
      <RotateCcw aria-hidden="true" />{t("filters.resetAll")}
    </Button>
  ) : null;

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <span onClickCapture={() => setOpen(true)} className="contents">{trigger}</span>
        <SheetContent side="bottom" className="flex flex-col gap-0 rounded-t-2xl p-0">
          <SheetHeader className="px-4 pb-2 pt-4">
            <SheetTitle>{text}</SheetTitle>
            <SheetDescription className={description ? "text-sm" : "sr-only"}>{description ?? text}</SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-3">{children}</div>
          <SheetFooter className="flex-row items-center justify-between gap-2 px-4 py-3">
            {reset ?? <span />}
            <Button type="button" onClick={() => setOpen(false)} className="min-w-28">
              {resultCount != null ? t("filters.showCount", { count: resultCount }) : t("filters.show")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side="bottom"
        align={align}
        collisionPadding={12}
        className={cn(
          "flex max-h-[min(var(--radix-popover-content-available-height),calc(100dvh-120px))] flex-col gap-0 overflow-hidden p-0",
          width === "md" ? "w-[min(92vw,380px)]" : width === "lg" ? "w-[min(92vw,560px)]" : "w-[min(94vw,860px)]",
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-4">{children}</div>
        {reset && <div className="flex justify-end border-t border-border px-3 py-2">{reset}</div>}
      </PopoverContent>
    </Popover>
  );
}

/** A titled group of fields inside FiltersButton. */
export function FilterSection({ title, children, className, action }: { title?: React.ReactNode; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-2", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-2">
          {title && <h3 className="text-sm font-semibold">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

// ── Active chips ─────────────────────────────────────────────────────────────

export type ActiveFilter = {
  key: string;
  label: React.ReactNode;
  onRemove: () => void;
  /** Accessible name of × when `label` is not plain text. */
  removeLabel?: string;
  /** A hidden (excluded) value reads struck through. */
  excluded?: boolean;
};

export function ActiveFilters({
  items,
  onReset,
  className,
  children,
}: {
  items: ReadonlyArray<ActiveFilter | false | null | undefined>;
  /** «Сбросить» after the chips (shown with 1+ chips). */
  onReset?: () => void;
  className?: string;
  /** Quiet context at the end of the row (e.g. «Итог $X · из них IMX $Y»). */
  children?: React.ReactNode;
}) {
  const t = commonI18n.t;
  const list = items.filter((x): x is ActiveFilter => !!x);
  if (list.length === 0 && !children) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5", className)}>
      {list.length > 0 && (
        <ul className="flex flex-wrap items-center gap-1.5" aria-label={t("filters.activeAria")}>
          {list.map((f) => (
            <li key={f.key} className="inline-flex min-h-7 items-center gap-0.5 rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg)] py-0.5 pl-2.5 pr-0.5 text-xs font-medium">
              <span className={cn("max-w-[16rem] truncate", f.excluded && "text-muted-foreground line-through decoration-1")}>{f.label}</span>
              <button
                type="button"
                onClick={f.onRemove}
                aria-label={t("filters.remove", { label: f.removeLabel ?? (typeof f.label === "string" ? f.label : f.key) })}
                className="grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-8 pointer-coarse:w-8"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
          {onReset && (
            <li>
              <Button type="button" variant="ghost" size="sm" onClick={onReset} className="h-7 px-2 text-xs text-muted-foreground">{t("filters.reset")}</Button>
            </li>
          )}
        </ul>
      )}
      {children}
    </div>
  );
}
