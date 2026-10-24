/**
 * The unlock field of the lock screen. Hidden until the first key (or a click / tap anywhere on the screen); the key
 * that woke it lands in the field, so nothing typed is lost. Enter submits, Esc hides and clears, 10 s without typing
 * hides and clears. A wrong code shakes the field and says how many attempts are left; the 5th wrong answer signs out
 * (the lock controller sends the tab to the sign-in page).
 */
import * as React from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { lockStore } from "@/lib/lock/lock-store";
import { MAX_UNLOCK_ATTEMPTS, type QuickCodeKind } from "@/lib/lock/lock-model";
import { lockEggOwnsKey } from "@/lib/lock/eggs/keys";
import { lockI18n } from "@/i18n/ns/lock";
import { prefersReducedMotion } from "./ambient";

const IDLE_HIDE_MS = 10_000;
const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "AltGraph", "Fn", "NumLock", "ScrollLock", "OS", "Tab"]);

type Message = { text: string; tone: "error" | "muted" } | null;

export function UnlockForm({
  hasCode, kind, attemptsLeft, onVisibleChange, onForgot,
}: {
  hasCode: boolean | null;
  kind: QuickCodeKind | null;
  attemptsLeft: number;
  onVisibleChange: (v: boolean) => void;
  onForgot: () => void;
}) {
  const { t } = lockI18n.useT();
  const [visible, setVisibleState] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<Message>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);
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

  const reveal = React.useCallback((firstChar?: string) => {
    if (!visibleRef.current) setVisible(true);
    // The field is always mounted (just transparent), so it can take focus inside this very event (mobile keyboards
    // only open from a focus within the user's gesture).
    inputRef.current?.focus();
    if (firstChar) setCode((c) => (c + firstChar).slice(0, 64));
    armIdle();
  }, [armIdle, setVisible]);

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

  const shake = () => {
    if (prefersReducedMotion()) return;
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
    const res = await lockStore.unlock(code);
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
          className="h-12 w-full rounded-full border border-white/15 bg-black/35 pl-5 pr-12 text-center text-lg tracking-[0.35em] text-white shadow-[0_8px_40px_rgba(0,0,0,0.35)] outline-none backdrop-blur-xl placeholder:text-sm placeholder:tracking-normal placeholder:text-white/55 focus-visible:border-white/35 focus-visible:ring-2 focus-visible:ring-white/25"
        />
        <button
          type="submit"
          disabled={busy || !code}
          tabIndex={visible ? 0 : -1}
          aria-label={t("screen.submit")}
          className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      <p id="lock-code-note" role="status" aria-live="polite" className={cn("min-h-5 text-center text-xs", note?.tone === "error" ? "text-[#ffb4a8]" : "text-white/60")}>
        {note?.text ?? (touch ? "" : t("screen.keys"))}
      </p>
      <button type="button" tabIndex={visible ? 0 : -1} onClick={onForgot} className="text-xs text-white/45 underline-offset-4 hover:text-white/80 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 rounded">
        {t("screen.forgot")}
      </button>
    </form>
  );
}
