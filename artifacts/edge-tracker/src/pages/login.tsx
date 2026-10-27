import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Loader2, UserRound } from "lucide-react";
import { setRevealOrigin } from "@/components/unlock-reveal";
import { LoginBackdrop, useSignInMotion } from "@/components/login-backdrop";
import { useAuth, type LoginError } from "@/contexts/auth-context";
import { useTheme } from "@/contexts/theme-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isLightTheme } from "@/lib/appearance/model";
import { useAmbientDrift } from "@/hooks/use-ambient-drift";
import { LanguageSegmented } from "@/i18n/language-switcher";
import { authI18n } from "@/i18n/ns/auth";
import { ForcedPasswordChange } from "@/components/auth/forced-password-change";
import { LoginClock } from "@/components/auth/login-clock";
import { SignInForm, readLastName, useLoginErrorText } from "@/components/auth/sign-in-form";
import { BusyShimmer, HERO_EASE, HeroRing, RimSweep, SuccessDisc, playHeroExit, playRimSweep, playShake, rippleFrom } from "@/components/shared/hero-fx";
import { WordReveal } from "@/components/shared/word-reveal";
import { Wordmark } from "@/components/ds/brand";

/**
 * Sign-in, with the lock screen's magic (components/lock-screen.tsx): the last «Вид» scene of this browser drifting
 * and leaning in 3D under the pointer (components/login-backdrop), a calm live clock with the New York session, a
 * breathing halo behind the wordmark, a greeting that surfaces word by word, the glass card rising with a light along
 * its rim. A wrong secret shakes the card; a right one folds the card into the lock's glass disc with the check that
 * draws itself, a ring opens, the scene moves toward you, and the site opens through the iris (unlock-reveal.tsx).
 * Step 2 «Новый пароль» appears in the same card when the account still has to set its own secret.
 * Motion follows this browser's last look (useSignInMotion → lib/motion); without it everything is simply there.
 */

/** «Вход → Новый пароль»: shown while the second step is active, so it reads as one process. */
function SignInSteps({ step }: { step: 1 | 2 }) {
  const { t } = authI18n.useT();
  const { user } = useAuth();
  const pin = user?.role !== "curator" && user?.role !== "admin";
  const items = [t("steps.signIn"), t(pin ? "steps.newPin" : "steps.newPassword")];
  return (
    <ol aria-label={t("steps.aria")} className="mt-5 flex items-center justify-center gap-2 text-xs">
      {items.map((label, i) => {
        const n = (i + 1) as 1 | 2;
        const done = n < step;
        const active = n === step;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
            {i > 0 && <span aria-hidden="true" className={cn("h-px w-6 origin-left animate-in fade-in-0 zoom-in-0 duration-[var(--dur-4)]", done || active ? "bg-primary/60" : "bg-border")} />}
            <span
              className={cn(
                "grid h-5 w-5 place-items-center rounded-full text-2xs font-semibold transition-colors duration-[var(--dur-3)]",
                done ? "bg-up/15 text-up" : active ? "bg-primary-solid text-primary-foreground animate-in zoom-in-50 duration-[var(--dur-3)]" : "bg-muted text-muted-foreground",
              )}
              aria-hidden="true"
            >
              {done ? <Check className="h-3 w-3 animate-in zoom-in-50 duration-[var(--dur-3)]" /> : n}
            </span>
            <span className={cn(active ? "font-medium text-foreground" : "text-muted-foreground")}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** The first word of the name typed at the last sign-in on this browser (the greeting), if any. */
function lastFirstName(): string {
  return (readLastName() ?? "").trim().split(/\s+/)[0] ?? "";
}

export default function LoginPage() {
  const { t } = authI18n.useT();
  const { loginAsGuest, passwordChangePending } = useAuth();
  const { theme } = useTheme();
  const light = isLightTheme(theme);
  const motion = useSignInMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const haloRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const sweepRef = useRef<HTMLSpanElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const langRef = useRef<HTMLDivElement>(null);
  const belowRef = useRef<HTMLDivElement>(null);
  const guestRef = useRef<HTMLButtonElement>(null);
  const drawnRef = useRef<(() => void) | null>(null);
  // The secret typed in step 1, kept in memory only, so step 2 doesn't ask for the current password again.
  const typedSecret = useRef<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [guestBusy, setGuestBusy] = useState(false);
  const [guestError, setGuestError] = useState<LoginError | null>(null);
  const [greetName] = useState(lastFirstName);
  const errorText = useLoginErrorText();
  useAmbientDrift(rootRef, haloRef, motion);

  /** The rows rise in one after another (ws-rise-in, index.css); `i` is the order. */
  const rise = (i: number): React.CSSProperties | undefined =>
    motion ? { animation: `ws-rise-in 620ms ${HERO_EASE} ${220 + i * 80}ms backwards` } : undefined;

  // The card's rim catches the light once it has risen.
  useEffect(() => { if (motion) playRimSweep(sweepRef.current, { delay: 620, duration: 1200 }); }, [motion]);

  /**
   * A right secret: the card folds into the glass disc, the check draws itself, then the lock's exit (ring, the scene
   * moving toward you); the iris on the site opens from the disc. Step 2 (`mustChange`) keeps the card instead.
   */
  const celebrate = useCallback(async (_origin: HTMLElement | null, mustChange = false) => {
    if (mustChange) return;
    const box = cardRef.current?.getBoundingClientRect();
    const center = box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    setRevealOrigin(center);
    if (!motion) return;
    const drawn = new Promise<void>((r) => { drawnRef.current = r; });
    setSuccess(true);
    cardRef.current?.animate?.(
      [
        { clipPath: "inset(0 0 0 0 round 24px)", opacity: 1, filter: "blur(0px)", transform: "scale(1)" },
        { clipPath: "inset(calc(50% - 28px) calc(50% - 28px) calc(50% - 28px) calc(50% - 28px) round 28px)", opacity: 0, filter: "blur(6px)", transform: "scale(0.96)" },
      ],
      { duration: 460, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" },
    );
    await drawn;
    await new Promise((r) => window.setTimeout(r, 140));
    await playHeroExit({ motion, origin: center, ring: ringRef.current, scene: sceneRef.current, content: [clockRef.current, belowRef.current, langRef.current] });
  }, [motion]);

  const shakeCard = useCallback(() => { if (motion) playShake(cardRef.current, { glow: true }); }, [motion]);

  async function handleGuest() {
    if (guestBusy || signingIn) return;
    setGuestBusy(true);
    setGuestError(null);
    const err = await loginAsGuest({ beforeEnter: () => celebrate(guestRef.current) });
    setGuestBusy(false);
    if (err) { setGuestError(err === "invalid" ? "network" : err); shakeCard(); }
  }

  return (
    <div
      ref={rootRef}
      className="relative flex min-h-[100dvh] w-full flex-col items-center justify-center gap-6 overflow-hidden bg-background px-4 pb-10 pt-[calc(3.75rem+env(safe-area-inset-top))]"
    >
      <LoginBackdrop sceneRef={sceneRef} />

      {/* Language before sign-in (saved locally, then to the profile after login: i18n/locale-sync.tsx). */}
      <div ref={langRef} className="absolute right-4 top-[calc(1rem+env(safe-area-inset-top))] z-raised" style={rise(-2)}>
        <LanguageSegmented />
      </div>

      <LoginClock ref={clockRef} className="relative z-raised [@media(max-height:700px)]:hidden" style={motion ? { animation: `ws-rise-in 900ms ${HERO_EASE} 60ms backwards` } : undefined} />

      <main className="relative z-raised flex w-full max-w-[400px] flex-col items-center gap-5">
        <div className="relative w-full">
          {success && (
            // The lock's glass disc with the check that draws itself (components/shared/hero-fx).
            <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-raised grid place-items-center">
              <SuccessDisc motion={motion} delay={220} onDrawn={() => drawnRef.current?.()} className={light ? "border-foreground/25 bg-foreground/85" : undefined} />
            </span>
          )}
          {/* Smoked glass over the scene: in dark a translucent black pane (no white sheen), light keeps the frosted card. */}
          <div
            ref={cardRef}
            className="glass-thick relative w-full rounded-3xl p-6 sm:p-7 dark:[--glass-sheen:rgb(255_255_255/0.03)] dark:[--glass-thick-bg:rgb(8_8_8/0.55)] dark:[--glass-border:rgb(255_255_255/0.1)]"
            style={motion ? { animation: `ws-rise-in 760ms ${HERO_EASE} 120ms backwards` } : undefined}
          >
            <RimSweep ref={sweepRef} />
            {/* Brand: the «WS_Desk» lockup over a breathing halo, the greeting surfacing word by word. */}
            <div className="relative flex flex-col items-center gap-3 text-center" style={rise(0)}>
              <div
                ref={haloRef}
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-1/2 h-[200%] w-[115%] -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ background: "radial-gradient(closest-side, hsl(var(--foreground) / 0.13), hsl(var(--foreground) / 0.04) 55%, transparent 78%)", filter: "blur(18px)" }}
              />
              <h1 className="relative text-[2.5rem] leading-none text-foreground"><Wordmark /></h1>
              <p className="relative text-base font-medium text-foreground">
                <WordReveal key={motion ? "m" : "s"} text={greetName ? t("greeting.backName", { name: greetName }) : t("greeting.first")} motion={motion} delay={420} maxStep={90} />
              </p>
              <p className="relative -mt-2 text-sm text-muted-foreground" style={rise(1)}>{t("tagline")}</p>
            </div>

            {passwordChangePending ? (
              <>
                <SignInSteps step={2} />
                <ForcedPasswordChange knownCurrent={typedSecret.current} motion={motion} rise={rise} onEnter={celebrate} onFailed={shakeCard} />
              </>
            ) : (
              <SignInForm
                motion={motion}
                rise={rise}
                busyElsewhere={guestBusy}
                onBusyChange={setSigningIn}
                onEnter={celebrate}
                onFailed={shakeCard}
                onAccepted={(secret) => { typedSecret.current = secret; }}
              />
            )}
          </div>
        </div>

        <div ref={belowRef} className="flex flex-col items-center gap-2" style={rise(6)}>
          {!passwordChangePending && (
            <Button
              ref={guestRef}
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleGuest}
              onPointerDown={(e) => rippleFrom(e, motion)}
              disabled={guestBusy || signingIn}
              aria-busy={guestBusy}
              className="relative min-h-10 overflow-hidden text-muted-foreground sm:min-h-8"
            >
              {guestBusy && <BusyShimmer />}
              {guestBusy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <UserRound aria-hidden="true" />}
              {t("guest")}
            </Button>
          )}
          {guestError && !passwordChangePending && (
            <p role="alert" className="flex items-start gap-1.5 text-xs text-down animate-in fade-in-0 slide-in-from-top-1 duration-[var(--dur-2)]">
              <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {errorText(guestError)}
            </p>
          )}
        </div>
      </main>

      <HeroRing ref={ringRef} className={light ? "border-foreground/40" : undefined} />
    </div>
  );
}
