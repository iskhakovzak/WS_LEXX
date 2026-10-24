/**
 * Guided tour: a spotlight on a real element of the screen + one card (title, one sentence, dots, «Назад» / «Далее» /
 * «Пропустить»). Steps and anchors: lib/onboarding/model (tourSteps, placeCard).
 *
 * - The backdrop dims the page but never takes the pointer: scrolling, the wheel and touch keep working underneath.
 * - The spotlight follows its anchor every frame (scroll in #main-content, resize, late layout); an anchor that is not
 *   on screen (collapsed on a phone, a closed group) → the card is centred over a plain dim.
 * - Keys: → / Enter next, ← back, Esc skip. Focus goes to the card's main button and returns where it was at the end.
 * - Non-modal (aria-modal false): nothing is trapped; the card is a labelled dialog read on focus.
 * - Reduced motion: no glide between anchors, no smooth scrolling. Never printed.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { onboardingI18n } from "@/i18n/ns/onboarding";
import { placeCard, tourKey, type Placement, type Rect, type TourStep } from "@/lib/onboarding/model";

const PAD = 6;
const PHONE = "(max-width: 767px)";

function isShown(el: Element): boolean {
  if (!(el instanceof HTMLElement) || el.getClientRects().length === 0) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const cs = window.getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05;
}

/** First anchor of the list that is on screen (inside the overlay itself never counts). */
export function findAnchor(selectors: readonly string[]): HTMLElement | null {
  for (const sel of selectors) {
    let list: NodeListOf<Element>;
    try { list = document.querySelectorAll(sel); } catch { continue; }
    for (const el of list) if (isShown(el) && !el.closest("[data-onboarding-tour]")) return el as HTMLElement;
  }
  return null;
}

/** Inside the viewport and not clipped by a scrolling ancestor (the sidebar's own scroller, #main-content). */
function fullyVisible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.top < 0 || r.left < 0 || r.bottom > window.innerHeight || r.right > window.innerWidth) return false;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = window.getComputedStyle(p).overflowY;
    if (oy === "visible") continue;
    const b = p.getBoundingClientRect();
    if (r.top < b.top - 1 || r.bottom > b.bottom + 1) return false;
  }
  return true;
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b || (!!a && !!b && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5);

export function Tour({ steps, onFinish }: { steps: TourStep[]; onFinish: (kind: "done" | "skipped") => void }) {
  const { t } = onboardingI18n.useT();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [place, setPlace] = useState<Placement>({ kind: "center" });
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const returnFocus = useRef<Element | null>(null);
  const [reduce] = useState(reducedMotion);
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;
  const titleId = "onboarding-tour-title";
  const bodyId = "onboarding-tour-body";

  const finish = useCallback((kind: "done" | "skipped") => {
    const back = returnFocus.current;
    onFinish(kind);
    if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
  }, [onFinish]);
  const next = useCallback(() => { if (last) finish("done"); else setIndex((i) => i + 1); }, [last, finish]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  useEffect(() => { returnFocus.current = document.activeElement; }, []);

  // New step: find its anchor, bring it into view, focus the main button.
  useLayoutEffect(() => {
    if (!step) return;
    const el = findAnchor(step.anchors);
    anchorRef.current = el;
    if (el && !fullyVisible(el) && el.getBoundingClientRect().height < window.innerHeight * 0.8) {
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: reduce ? "auto" : "smooth" });
    }
    primaryRef.current?.focus({ preventScroll: true });
  }, [step, reduce]);

  // Follow the anchor: one rect read per frame, a state update only when something moved.
  useEffect(() => {
    let raf = 0;
    let lastRect: Rect | null = null;
    let lastPlace = "";
    const tick = () => {
      let el = anchorRef.current;
      if (el && (!el.isConnected || !isShown(el))) el = anchorRef.current = step ? findAnchor(step.anchors) : null;
      if (!el && step) el = anchorRef.current = findAnchor(step.anchors);
      const r = el?.getBoundingClientRect();
      const nextRect: Rect | null = r ? { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 } : null;
      if (!sameRect(nextRect, lastRect)) { lastRect = nextRect; setRect(nextRect); }
      const card = cardRef.current;
      const phone = window.matchMedia?.(PHONE).matches ?? false;
      const dock = phone ? document.querySelector('[data-tour="dock"]')?.getBoundingClientRect() : undefined;
      const anchorIsDock = !!dock && !!r && r.top >= dock.top - 1;
      const p = placeCard(nextRect, { width: card?.offsetWidth ?? 320, height: card?.offsetHeight ?? 180 }, {
        width: window.innerWidth,
        height: window.innerHeight,
        bottomInset: dock && !anchorIsDock ? window.innerHeight - dock.top + 4 : 0,
      });
      const key = JSON.stringify(p);
      if (key !== lastPlace) { lastPlace = key; setPlace(p); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = tourKey(e.key);
      if (!k || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      // Enter on a focused button already clicks it; only a bare Enter advances.
      if (e.key === "Enter" && e.target instanceof HTMLElement && e.target.closest("button, a, [role='button']")) return;
      // An open dialog (the palette, «Вид») owns its keys.
      if (document.querySelector("[role='dialog'][data-state='open'], [role='alertdialog']")) return;
      e.preventDefault();
      if (k === "next") next();
      else if (k === "back") back();
      else finish("skipped");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, back, finish]);

  if (!step) return null;
  const glide = reduce ? undefined : "transform 220ms cubic-bezier(0.2, 0, 0, 1), width 220ms cubic-bezier(0.2, 0, 0, 1), height 220ms cubic-bezier(0.2, 0, 0, 1)";
  const cardStyle = place.kind === "center" ? undefined : { top: place.top, left: place.left };

  return (
    <div data-onboarding-tour="" className="pointer-events-none fixed inset-0 z-modal print:hidden">
      {rect ? (
        <div
          aria-hidden="true"
          className="absolute left-0 top-0 rounded-2xl ring-2 ring-primary/70"
          style={{
            width: rect.width,
            height: rect.height,
            transform: `translate3d(${rect.left}px, ${rect.top}px, 0)`,
            boxShadow: "0 0 0 200vmax rgb(0 0 0 / 0.55)",
            transition: glide,
          }}
        />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 bg-black/55" />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className={cn(
          "glass-thick glass-solid pointer-events-auto absolute bg-popover text-popover-foreground w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl p-4 shadow-2xl",
          place.kind === "center" && "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
        )}
        style={cardStyle}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{t("tour.stepOf", { n: index + 1, total: steps.length })}</p>
          <ol className="flex items-center gap-1.5" aria-hidden="true">
            {steps.map((s, i) => (
              <li
                key={s.id}
                className={cn("h-1.5 rounded-full transition-[width,background-color] duration-[var(--dur-2)] motion-reduce:transition-none", i === index ? "w-4 bg-primary" : i < index ? "w-1.5 bg-primary/50" : "w-1.5 bg-muted-foreground/30")}
              />
            ))}
          </ol>
        </div>
        <h2 id={titleId} className="mt-2 text-base font-semibold leading-snug text-foreground">{t(`tour.steps.${step.copy}.title`)}</h2>
        <p id={bodyId} className="mt-1 text-sm leading-relaxed text-muted-foreground">{t(`tour.steps.${step.copy}.body`)}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => finish("skipped")}>{t("tour.skip")}</Button>
          <div className="flex items-center gap-1.5">
            {index > 0 && <Button variant="ghost" size="sm" onClick={back}>{t("tour.back")}</Button>}
            <Button ref={primaryRef} size="sm" onClick={next}>{last ? t("tour.done") : t("tour.next")}</Button>
          </div>
        </div>
        <p className="mt-3 hidden text-2xs text-muted-foreground md:block">{t("tour.keys")}</p>
      </div>
    </div>
  );
}
