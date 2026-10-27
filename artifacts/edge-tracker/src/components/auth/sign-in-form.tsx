/**
 * Sign-in, step 1 (owner decision 2026-10-17): no roster before sign-in — the name is TYPED (the API resolves it across
 * RU / EN / UZ spellings) and the secret is a PIN (traders) or a password (staff). Locks are per account and survive a
 * reload (localStorage). The page (pages/login.tsx) owns the card and its hero moments: `onEnter` plays the success
 * animation before the session is applied, `onFailed` shakes the card.
 * Motion here: a light ring follows focus between the fields, the Caps Lock and error lines slide in, the button
 * answers a press with a ripple and shimmers while it waits.
 */
import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowRight, ArrowUpFromLine, Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { BusyShimmer, FocusGlow, rippleFrom } from "@/components/shared/hero-fx";
import { useAuth, type LoginError } from "@/contexts/auth-context";
import { authI18n } from "@/i18n/ns/auth";
import { cn } from "@/lib/utils";

const LAST_NAME_KEY = "ws_lexx_last_trader";
const SECRET_KIND_KEY = "ws_lexx_secret_kind";
const LOCKOUT_KEY = "ws_lexx_login_lockout";

type SecretKind = "pin" | "password";
type Lockout = { name: string; until: number; kind: "locked" | "rate_limited" };

export function readLS(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeLS(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage blocked */ }
}
const nameKey = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

/** The name typed at the last successful sign-in on this browser (the page greets it). */
export const readLastName = () => readLS(LAST_NAME_KEY);

function readLockout(): Lockout | null {
  try {
    const v = JSON.parse(readLS(LOCKOUT_KEY) ?? "null") as Lockout | null;
    return v && typeof v.until === "number" && v.until > Date.now() ? v : null;
  } catch { return null; }
}

const fmtCountdown = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

/** Error text for a sign-in failure (also used by the page for the guest button). */
export function useLoginErrorText(remaining = "") {
  const { t } = authI18n.useT();
  return (err: LoginError): string => {
    switch (err) {
      case "invalid": return t("errors.invalid");
      case "locked": return t("errors.locked", { time: remaining });
      case "rate_limited": return t("errors.rateLimited", { time: remaining });
      case "banned": return t("errors.banned");
      case "guest_disabled": return t("errors.guestDisabled");
      default: return t("errors.network");
    }
  };
}

const slideIn = "animate-in fade-in-0 slide-in-from-top-1 duration-[var(--dur-2)] ease-smooth";

export function SignInForm({
  motion, rise, busyElsewhere, onBusyChange, onEnter, onFailed, onAccepted,
}: {
  motion: boolean;
  /** Entrance style of the n-th row (the page's rise-in sequence). */
  rise: (i: number) => React.CSSProperties | undefined;
  /** The guest button is working: no second sign-in meanwhile. */
  busyElsewhere: boolean;
  onBusyChange: (busy: boolean) => void;
  /** Success animation, awaited before the session is applied (`mustChange`: step 2 follows instead). */
  onEnter: (origin: HTMLElement | null, mustChange: boolean) => Promise<void>;
  onFailed: () => void;
  /** The secret the server accepted (kept in memory by the page for step 2). */
  onAccepted: (secret: string) => void;
}) {
  const { t } = authI18n.useT();
  const { loginAsTrader } = useAuth();
  const [name, setName] = useState<string>(() => readLS(LAST_NAME_KEY) ?? "");
  const [password, setPassword] = useState("");
  const [kind, setKind] = useState<SecretKind>(() => (readLS(SECRET_KIND_KEY) === "password" ? "password" : "pin"));
  const [error, setError] = useState<LoginError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [lockout, setLockout] = useState<Lockout | null>(readLockout);
  const [now, setNow] = useState(() => Date.now());
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  // Synchronous guard: a double Enter / double tap fires two submits before `submitting` re-renders.
  const inFlight = useRef(false);

  // A lock is per account: it applies only while the same name is typed.
  const locked = !!lockout && lockout.until > now && nameKey(lockout.name) === nameKey(name);
  useEffect(() => {
    if (!lockout) return;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [lockout]);
  useEffect(() => {
    if (lockout && lockout.until <= now) {
      writeLS(LOCKOUT_KEY, null);
      setLockout(null);
      if (error === "locked" || error === "rate_limited") setError(null);
    }
  }, [lockout, now, error]);

  // Focus lands on the first empty field: the secret when the name is remembered, else the name.
  useEffect(() => {
    (name.trim() ? passwordRef : nameRef).current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remainingText = fmtCountdown(Math.max(0, (lockout?.until ?? 0) - now));
  const errorText = useLoginErrorText(remainingText);

  function trackCaps(e: React.KeyboardEvent<HTMLInputElement>) {
    if (typeof e.getModifierState === "function") setCapsLock(e.getModifierState("CapsLock"));
  }

  function switchKind() {
    const next: SecretKind = kind === "pin" ? "password" : "pin";
    setKind(next);
    writeLS(SECRET_KIND_KEY, next);
    requestAnimationFrame(() => passwordRef.current?.focus());
  }

  const clearSoftError = () => { if (error && error !== "locked" && error !== "rate_limited") setError(null); };

  async function handleLogin(e?: React.FormEvent) {
    e?.preventDefault();
    const typedName = name.trim();
    if (!typedName) { nameRef.current?.focus(); return; }
    if (!password) { passwordRef.current?.focus(); return; }
    if (inFlight.current || submitting || locked || busyElsewhere) return;
    inFlight.current = true;
    setSubmitting(true);
    onBusyChange(true);
    const accept = () => {
      writeLS(LAST_NAME_KEY, typedName);
      writeLS(LOCKOUT_KEY, null);
      // Remember the keyboard: a password (letters) vs a PIN (digits only).
      writeLS(SECRET_KIND_KEY, /^\d+$/.test(password) ? "pin" : "password");
      onAccepted(password);
    };
    const failure = await loginAsTrader(typedName, password, {
      beforeEnter: (mustChange) => { accept(); return onEnter(submitRef.current, mustChange); },
    }).finally(() => { inFlight.current = false; });
    setSubmitting(false);
    onBusyChange(false);
    if (!failure) return;
    setError(failure.error);
    if (failure.error === "locked" || failure.error === "rate_limited") {
      const lock: Lockout = { name: typedName, until: Date.now() + (failure.retryAfterSec ?? 900) * 1000, kind: failure.error };
      writeLS(LOCKOUT_KEY, JSON.stringify(lock));
      setLockout(lock);
      setNow(Date.now());
    }
    if (failure.error === "invalid") setPassword("");
    onFailed();
    // A lock disables the secret field, so focus would fall to <body>: keep it on the name instead.
    (failure.error === "locked" || failure.error === "rate_limited" ? nameRef : passwordRef).current?.focus();
  }

  // While locked the message stays visible even if the error state was cleared by typing.
  const shownError: LoginError | null = locked ? lockout!.kind : error;
  const isPin = kind === "pin";
  const canSubmit = !!name.trim() && password.length > 0 && !submitting && !locked && !busyElsewhere;

  return (
    <form ref={formRef} className="relative mt-6 flex flex-col gap-4" onSubmit={handleLogin} noValidate>
      <FocusGlow container={formRef} motion={motion} />
      {/* Name — typed, never picked from a list (no roster before sign-in). */}
      <div className="flex flex-col gap-1.5" style={rise(2)}>
        <label htmlFor="login-name" className="text-xs text-muted-foreground">{t("name.label")}</label>
        <Input
          ref={nameRef}
          id="login-name"
          name="username"
          autoComplete="username"
          autoCapitalize="words"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          maxLength={100}
          value={name}
          onChange={(e) => { setName(e.target.value); clearSoftError(); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim() && !password) { e.preventDefault(); passwordRef.current?.focus(); }
          }}
          placeholder={t("name.placeholder")}
          className="h-11 text-base sm:text-sm"
        />
      </div>

      {/* Secret: PIN (digits keyboard) or password */}
      <div className="flex flex-col gap-1.5" style={rise(3)}>
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="login-password" className="text-xs text-muted-foreground">
            {isPin ? t("secret.pin") : t("secret.password")}
          </label>
          <button
            type="button"
            onClick={switchKind}
            className="-my-1.5 -mr-1.5 inline-flex min-h-8 items-center rounded-md px-1.5 text-2xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {isPin ? t("secret.usePassword") : t("secret.usePin")}
          </button>
        </div>
        <div className="relative">
          <Input
            ref={passwordRef}
            id="login-password"
            name="password"
            type={showPassword ? "text" : "password"}
            inputMode={isPin ? "numeric" : "text"}
            autoComplete="current-password"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            maxLength={200}
            value={password}
            disabled={locked}
            onChange={(e) => { setPassword(e.target.value); clearSoftError(); }}
            onKeyDown={trackCaps}
            onKeyUp={trackCaps}
            onBlur={() => setCapsLock(false)}
            placeholder={isPin ? t("secret.pinPlaceholder") : t("secret.passwordPlaceholder")}
            aria-invalid={shownError === "invalid" || undefined}
            aria-describedby={[shownError ? "login-error" : "", capsLock ? "login-caps" : ""].filter(Boolean).join(" ") || undefined}
            className={cn(
              "h-11 pr-12 text-base tracking-wide transition-[background-color,border-color,box-shadow] duration-[var(--dur-3)] sm:text-sm",
              shownError === "invalid" && "border-down/60 ring-2 ring-down/20",
            )}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? t("secret.hide") : t("secret.show")}
            aria-controls="login-password"
            className="press absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {showPassword ? <EyeOff className="h-4 w-4 animate-in fade-in-0 zoom-in-75 duration-[var(--dur-2)]" aria-hidden="true" /> : <Eye className="h-4 w-4 animate-in fade-in-0 zoom-in-75 duration-[var(--dur-2)]" aria-hidden="true" />}
          </button>
        </div>
        {capsLock && (
          <p id="login-caps" className={cn("flex items-center gap-1.5 text-xs text-[hsl(var(--chart-3))]", slideIn)} role="status">
            <ArrowUpFromLine className="h-3.5 w-3.5 motion-safe:animate-bounce [animation-iteration-count:2]" aria-hidden="true" />
            {t("secret.capsLock")}
          </p>
        )}
        {/* Errors and locks sit right under the field they concern (semantic colour + icon, not a banner). */}
        {shownError && (
          <p key={shownError} id="login-error" role="alert" className={cn("flex items-start gap-1.5 text-xs text-down", slideIn)}>
            {locked ? <Lock className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            <span className={cn(locked && "tabular-nums")}>{errorText(shownError)}</span>
          </p>
        )}
      </div>

      <Button
        ref={submitRef}
        type="submit"
        size="lg"
        disabled={!canSubmit}
        aria-busy={submitting}
        onPointerDown={(e) => rippleFrom(e, motion)}
        className="relative h-11 w-full overflow-hidden text-sm"
        style={rise(4)}
      >
        {submitting && <BusyShimmer />}
        {submitting ? (
          <>
            <Loader2 className="animate-spin" aria-hidden="true" />
            {t("submitting")}
          </>
        ) : locked ? (
          <span className="tabular-nums">{t("lockedButton", { time: remainingText })}</span>
        ) : (
          <>
            {t("submit")}
            <ArrowRight aria-hidden="true" />
          </>
        )}
      </Button>
      <p className="-mt-1 hidden items-center justify-center gap-1.5 text-xs text-muted-foreground sm:flex" style={rise(5)}>
        <Kbd>Enter</Kbd> {t("enterHint")}
      </p>
    </form>
  );
}
