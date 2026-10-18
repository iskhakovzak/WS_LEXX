import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/auth-context";
import { authI18n } from "@/i18n/ns/auth";
import { cn } from "@/lib/utils";

const STAFF_MIN = 10;

/**
 * Sign-in, step 2: a curator/admin whose password is shorter than the staff minimum sets a new one before the app
 * opens (the API refuses everything else for this session). `knownCurrent` is the secret typed in step 1 (kept in
 * memory only) — when present the «current password» field is not asked again.
 */
export function ForcedPasswordChange({ knownCurrent }: { knownCurrent: string | null }) {
  const { t } = authI18n.useT();
  const { user, changePassword, logout } = useAuth();
  const min = Math.max(user?.secretMin ?? STAFF_MIN, STAFF_MIN);
  const [current, setCurrent] = useState(knownCurrent ?? "");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  const askCurrent = !knownCurrent;
  const tooShort = next.length > 0 && next.length < min;
  const mismatch = repeat.length > 0 && repeat !== next;
  const same = next.length > 0 && next === current;
  const valid = current.length > 0 && next.length >= min && next === repeat && !same;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    const err = await changePassword(current, next);
    setSaving(false);
    if (err) setError(err === "network" ? t("errors.network") : err || t("forced.failed"));
  }

  return (
    <form className="mt-5 flex flex-col gap-4" onSubmit={submit} noValidate autoComplete="on">
      <div className="flex flex-col gap-1 text-center">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{t("forced.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("forced.description", { min })}</p>
        {user?.traderName && <p className="text-xs text-muted-foreground">{t("forced.signedInAs", { name: user.traderName })}</p>}
      </div>
      {/* Lets password managers attach the new password to the right account. */}
      <input type="text" name="username" autoComplete="username" value={user?.traderName ?? ""} readOnly hidden />

      {askCurrent && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pwc-current" className="text-xs text-muted-foreground">{t("forced.current")}</label>
          <Input ref={firstRef} id="pwc-current" type="password" autoComplete="current-password" maxLength={200}
            value={current} onChange={(e) => { setCurrent(e.target.value); setError(null); }} className="h-11" />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor="pwc-new" className="text-xs text-muted-foreground">{t("forced.next")}</label>
          <span className={cn("text-2xs tabular-nums", next.length >= min ? "text-up" : "text-muted-foreground")} aria-hidden="true">
            {t("forced.counter", { count: Math.min(next.length, 999), min })}
          </span>
        </div>
        <Input ref={askCurrent ? undefined : firstRef} id="pwc-new" type="password" autoComplete="new-password" maxLength={200}
          value={next} onChange={(e) => { setNext(e.target.value); setError(null); }}
          aria-invalid={tooShort || same || undefined} aria-describedby={tooShort || same ? "pwc-new-err" : undefined}
          className="h-11" />
        {(tooShort || same) && (
          <p id="pwc-new-err" className="flex items-center gap-1.5 text-xs text-down">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {same ? t("forced.same") : t("forced.tooShort", { min })}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="pwc-repeat" className="text-xs text-muted-foreground">{t("forced.repeat")}</label>
        <div className="relative">
          <Input id="pwc-repeat" type="password" autoComplete="new-password" maxLength={200}
            value={repeat} onChange={(e) => { setRepeat(e.target.value); setError(null); }}
            aria-invalid={mismatch || undefined} aria-describedby={mismatch ? "pwc-repeat-err" : error ? "pwc-error" : undefined}
            className="h-11 pr-10" />
          {repeat.length > 0 && !mismatch && next.length >= min && (
            <Check className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-up" aria-hidden="true" />
          )}
        </div>
        {mismatch && (
          <p id="pwc-repeat-err" className="flex items-center gap-1.5 text-xs text-down">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("forced.mismatch")}
          </p>
        )}
        {error && (
          <p id="pwc-error" role="alert" className="flex items-start gap-1.5 text-xs text-down">
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
      </div>

      <Button type="submit" size="lg" disabled={!valid || saving} aria-busy={saving} className="h-11 w-full text-sm">
        {saving ? <><Loader2 className="animate-spin" aria-hidden="true" />{t("forced.saving")}</> : t("forced.submit")}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={logout} disabled={saving} className="self-center text-muted-foreground">
        <LogOut aria-hidden="true" />
        {t("forced.cancel")}
      </Button>
    </form>
  );
}
