/**
 * The unlock field of the lock screen. Hidden until the first key (or a click / tap anywhere on the screen); the key
 * that woke it lands in the field, so nothing typed is lost. Enter submits, Esc hides and clears, 10 s without typing
 * hides and clears. A wrong code shakes the field and says how many attempts are left; the 5th wrong answer signs out
 * (the lock controller sends the tab to the sign-in page).
 * Motion (the viewer's «Движение фона», passed in as `motion`): the field unfolds from the middle out of a blur with a
 * light sweep along its rim, the hint lines follow; a right code melts the pill away and a glass disc rises in its
 * place with a check that draws itself, then `onSuccess` (the screen's exit) runs before the lock goes away.
 */
import * as React from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { lockStore } from "@/lib/lock/lock-store";
import { MAX_UNLOCK_ATTEMPTS, type QuickCodeKind } from "@/lib/lock/lock-model";
import { lockEggOwnsKey } from "@/lib/lock/eggs/keys";
import { lockI18n } from "@/i18n/ns/lock";

const IDLE_HIDE_MS = 10_000;
const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "AltGraph", "Fn", "NumLock", "ScrollLock", "OS", "Tab"]);

type Message = { text: string; tone: "error" | "muted" } | null;

const EASE_OUT = "cubic-bezier(0.2, 0.9, 0.2, 1)";
const finished = (a: Animation | undefined) => (a ? a.finished.then(() => undefined, () => undefined) : Promise.resolve());

export function UnlockForm({
  hasCode, kind, attemptsLeft, motion, onVisibleChange, onForgot, onSuccess,
}: {
  hasCode: boolean | null;
  kind: QuickCodeKind | null;
  attemptsLeft: number;
  /** Background / UI motion allowed («Движение фона»). */
  motion: boolean;
  onVisibleChange: (v: boolean) => void;
  onForgot: () => void;
  /** The screen's exit animation, awaited before the lock goes away. */
  onSuccess: () => Promise<void>;
}) {
  const { t } = lockI18n.useT();
  const [visible, setVisibleState] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<Message>(null);
  const [success, setSuccess] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const sweepRef = React.useRef<HTMLSpanElement>(null);
  const restRef = React.useRef<HTMLDivElement>(null);
  const badgeRef = React.useRef<HTMLSpanElement>(null);
  const tickRef = React.useRef<SVGPathElement>(null);
  const idleRef = React.useRef(0);
  const visibleRef = React.useRef(false);

  const setVisible = React.useCallback((v: boolean) => {
    visibleRef.current = v;
    setVisibleState(v);
    onVisibleChange(v);
  }, [onVisibleChange]);

  const hide = React.useCallback(() => {
    window.clearTimeout(idleRef.current);
    setVisible(false);
    setCode("");
    setMessage(null);
    inputRef.current?.blur();
  }, [setVisible]);

  const armIdle = React.useCallback(() => {
    window.clearTimeout(idleRef.current);
    idleRef.current = window.setTimeout(hide, IDLE_HIDE_MS);
  }, [hide]);

  /** Entrance: the pill unfolds from its middle out of a blur, a light runs along the rim, the lines below follow. */
  const playEntrance = React.useCallback(() => {
    if (!motion) return;
    boxRef.current?.animate?.(
      [
        { clipPath: "inset(0 38% round 999px)", transform: "scale(0.9)", filter: "blur(10px)", opacity: 0 },
        { clipPath: "inset(0 0% round 999px)", transform: "scale(1)", filter: "blur(0px)", opacity: 1 },
      ],
      { duration: 560, easing: EASE_OUT },
    );
    sweepRef.current?.animate?.(
      [{ transform: "translateX(-120%)", opacity: 0 }, { opacity: 0.9, offset: 0.35 }, { transform: "translateX(220%)", opacity: 0 }],
      { duration: 900, delay: 260, easing: "ease-in-out" },
    );
    restRef.current?.animate?.(
      [{ transform: "translateY(6px)", opacity: 0, filter: "blur(4px)" }, { transform: "translateY(0)", opacity: 1, filter: "blur(0px)" }],
      { duration: 420, delay: 180, easing: EASE_OUT, fill: "backwards" },
    );
  }, [motion]);

  const reveal = React.useCallback((firstChar?: string) => {
    if (!visibleRef.current) { setVisible(true); playEntrance(); }
    // The field is always mounted (just transparent), so it can take focus inside this very event (mobile keyboards
    // only open from a focus within the user's gesture).
    inputRef.current?.focus();
    if (firstChar) setCode((c) => (c + firstChar).slice(0, 64));
    armIdle();
  }, [armIdle, setVisible, playEntrance]);

  // Any key anywhere wakes the field; printable keys go into it.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || MODIFIERS.has(e.key)) return;
      if (lockEggOwnsKey(e.target, e.key)) return; // an open mini-game / the launcher's buttons (./eggs)
      if (e.key === "Escape") { if (visibleRef.current) { e.preventDefault(); hide(); } return; }
      const focused = document.activeElement === inputRef.current;
      if (focused) { armIdle(); return; }
      const printable = e.key.length === 1;
      if (printable || e.key === "Enter" || e.key === " " || e.key === "Backspace") {
        e.preventDefault();
        reveal(printable && e.key !== " " ? e.key : undefined);
      }
    };
    // A click / tap anywhere (outside the form, which stops its own clicks) wakes it too.
    const onClick = () => reveal();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("click", onClick);
    };
  }, [armIdle, hide, reveal]);

  React.useEffect(() => () => window.clearTimeout(idleRef.current), []);

  /** A right code: the pill folds into a circle around the check, which pops; then the screen's exit. */
  const playSuccess = async () => {
    setSuccess(true);
    if (motion) {
      restRef.current?.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: "forwards" });
      // The pill melts toward its centre; the disc rises out of it; the tick draws itself.
      boxRef.current?.animate?.(
        [{ transform: "scaleX(1)", opacity: 1, filter: "blur(0px)" }, { transform: "scaleX(0.25)", opacity: 0, filter: "blur(6px)" }],
        { duration: 320, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" },
      );
      badgeRef.current?.animate?.(
        [
          { transform: "scale(0.4)", opacity: 0, filter: "blur(8px)" },
          { transform: "scale(1.08)", opacity: 1, filter: "blur(0px)", offset: 0.65 },
          { transform: "scale(1)", opacity: 1, filter: "blur(0px)" },
        ],
        { duration: 520, delay: 140, easing: EASE_OUT, fill: "backwards" },
      );
      await finished(tickRef.current?.animate?.(
        [{ strokeDashoffset: 24 }, { strokeDashoffset: 0 }],
        { duration: 380, delay: 420, easing: "cubic-bezier(0.65, 0, 0.35, 1)", fill: "backwards" },
      ));
      await new Promise((r) => window.setTimeout(r, 160));
    }
    await onSuccess();
  };

  const shake = () => {
    if (!motion) return;
    boxRef.current?.animate?.(
      [{ transform: "translateX(0)" }, { transform: "translateX(-10px)" }, { transform: "translateX(9px)" }, { transform: "translateX(-6px)" }, { transform: "translateX(4px)" }, { transform: "translateX(0)" }],
      { duration: 420, easing: "ease-out" },
    );
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy || !code) return;
    setBusy(true);
    window.clearTimeout(idleRef.current);
    const res = await lockStore.unlock(code, { beforeApply: playSuccess });
    setBusy(false);
    if (res.ok) return; // the screen unmounts
    setCode("");
    armIdle();
    if (res.reason === "wrong") {
      setMessage({ text: t("screen.wrong", { count: res.attemptsLeft }), tone: "error" });
      shake();
    } else if (res.reason === "rateLimited") {
      setMessage({ text: t("screen.rateLimited"), tone: "error" });
      shake();
    } else if (res.reason === "network") {
      setMessage({ text: t("screen.network"), tone: "error" });
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const touch = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
  const label = hasCode === false ? t("screen.passwordLabel") : t("screen.codeLabel");
  const numeric = hasCode !== false && kind !== "phrase";
  const note: Message = message ?? (attemptsLeft < MAX_UNLOCK_ATTEMPTS ? { text: t("screen.left", { count: attemptsLeft }), tone: "muted" } : null);

  return (
    <form
      onSubmit={submit}
      onClick={(e) => e.stopPropagation()}
      aria-hidden={!visible}
      className={cn(
        "flex w-[min(20rem,calc(100vw-2rem))] flex-col items-center gap-3 transition-[opacity,filter,transform] duration-300 ease-out",
        visible ? "opacity-100 blur-0" : "pointer-events-none translate-y-2 opacity-0 blur-md",
      )}
    >
      <div className="relative w-full">
        {success && (
          // The glass disc with the self-drawing tick (a right code).
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-raised grid place-items-center">
            <span
              ref={badgeRef}
              className="grid h-14 w-14 place-items-center rounded-full border border-white/35 bg-white/10 backdrop-blur-xl"
              style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.06) inset, 0 10px 40px rgba(0,0,0,0.45), 0 0 36px rgba(255,255,255,0.22)" }}
            >
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none">
                <path ref={tickRef} d="M5.5 12.5l4.2 4.2L18.5 7.8" stroke="white" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={24} />
              </svg>
            </span>
          </span>
        )}
        <div ref={boxRef} className="relative w-full">
          <label htmlFor="lock-code" className="sr-only">{label}</label>
          <input
            ref={inputRef}
            id="lock-code"
            type="password"
            value={code}
            onChange={(e) => { setCode(e.target.value.slice(0, 64)); setMessage(null); armIdle(); }}
            placeholder={label}
            inputMode={numeric ? "numeric" : "text"}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            data-1p-ignore=""
            data-lpignore="true"
            tabIndex={visible ? 0 : -1}
            aria-invalid={message?.tone === "error" || undefined}
            aria-describedby="lock-code-note"
            disabled={busy}
            className={cn(
              "h-12 w-full rounded-full border border-white/15 bg-black/35 pl-5 pr-12 text-center text-lg tracking-[0.35em] text-white shadow-[0_8px_40px_rgba(0,0,0,0.35)] outline-none backdrop-blur-xl transition-[border-color,box-shadow,color] duration-300 placeholder:text-sm placeholder:tracking-normal placeholder:text-white/55 focus-visible:border-white/35 focus-visible:ring-2 focus-visible:ring-white/25",
            )}
          />
          {/* The light that runs along the rim when the field appears. */}
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
            <span ref={sweepRef} className="absolute inset-y-0 left-0 w-1/2 opacity-0" style={{ background: "linear-gradient(100deg, transparent, rgba(255,255,255,0.22), transparent)" }} />
          </span>
          <button
            type="submit"
            disabled={busy || !code}
            tabIndex={visible ? 0 : -1}
            aria-label={t("screen.submit")}
            className={cn(
              "absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
            )}
          >
            {busy || success ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </div>
      <div ref={restRef} className="flex flex-col items-center gap-3">
        <p id="lock-code-note" role="status" aria-live="polite" className={cn("min-h-5 text-center text-xs", note?.tone === "error" ? "text-[#ffb4a8]" : "text-white/60")}>
          {note?.text ?? (touch ? "" : t("screen.keys"))}
        </p>
        <button type="button" tabIndex={visible ? 0 : -1} onClick={onForgot} className="text-xs text-white/45 underline-offset-4 hover:text-white/80 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 rounded">
          {t("screen.forgot")}
        </button>
      </div>
    </form>
  );
}
