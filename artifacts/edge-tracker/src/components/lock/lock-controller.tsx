/**
 * Screen lock wiring, mounted once for a signed-in member (App): the shortcut, lock requests from the header button /
 * user menu / Ctrl+K palette, auto-lock after N idle minutes, the first-lock prompt for a quick code, the 5-strike
 * sign-out and the scroll restore after an unlock. Renders only the prompt dialog.
 *
 * No quick code yet: the first manual lock asks for one («Сохранить и заблокировать») with a way out («Пока без кода —
 * по паролю аккаунта», remembered on this browser). Auto-lock never asks: without a code the account password unlocks.
 */
import * as React from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { QuickCodeField, isQuickCodeValid } from "@/components/shared/quick-code-field";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "@/hooks/use-toast";
import { isLockShortcut, shouldAutoLock } from "@/lib/lock/lock-model";
import {
  LOCK_REQUEST_EVENT, acceptNoCode, lockStore, noCodeAccepted, takeSavedScroll, useAutoLock, useLockState,
} from "@/lib/lock/lock-store";
import { useQuickCode, useSaveQuickCode } from "@/lib/lock/quick-code-api";
import { lockI18n } from "@/i18n/ns/lock";

const ACTIVITY_KEY = "ws_lexx_activity";
const ACTIVITY_WRITE_MS = 5_000;
const IDLE_CHECK_MS = 15_000;

/** Last activity across every tab of this browser (one tab in use keeps the others from auto-locking it). */
function readSharedActivity(): number {
  try { return Number(localStorage.getItem(ACTIVITY_KEY)) || 0; } catch { return 0; }
}

function useAutoLockTimer(minutes: number, locked: boolean) {
  React.useEffect(() => {
    if (!minutes || locked) return;
    let last = Date.now();
    let written = 0;
    const mark = () => {
      last = Date.now();
      if (last - written > ACTIVITY_WRITE_MS) {
        written = last;
        try { localStorage.setItem(ACTIVITY_KEY, String(last)); } catch { /* ignore */ }
      }
    };
    mark();
    const events = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, mark, { passive: true });
    const timer = window.setInterval(() => {
      if (shouldAutoLock(Math.max(last, readSharedActivity()), Date.now(), minutes)) lockStore.lock();
    }, IDLE_CHECK_MS);
    return () => {
      window.clearInterval(timer);
      for (const e of events) window.removeEventListener(e, mark);
    };
  }, [minutes, locked]);
}

/** After an unlock the page re-mounts and refetches: scroll back once there is enough content (≤ 5 s, until the user scrolls). */
function restoreScroll(top: number) {
  const until = Date.now() + 5_000;
  let stop = false;
  const cancel = () => { stop = true; };
  window.addEventListener("wheel", cancel, { once: true, passive: true });
  window.addEventListener("touchmove", cancel, { once: true, passive: true });
  const step = () => {
    const el = document.getElementById("main-content");
    if (stop || Date.now() > until) return;
    if (el && el.scrollHeight - el.clientHeight >= top - 2) { el.scrollTop = top; return; }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function FirstLockPrompt({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = lockI18n.useT();
  const save = useSaveQuickCode();
  const [code, setCode] = React.useState("");
  const [invalid, setInvalid] = React.useState(false);
  React.useEffect(() => { if (!open) { setCode(""); setInvalid(false); } }, [open]);

  const saveAndLock = () => {
    if (!isQuickCodeValid(code)) { setInvalid(true); return; }
    save.mutate(code, {
      onSuccess: () => { onOpenChange(false); lockStore.lock(); },
      onError: () => toast({ title: t("code.failed"), variant: "destructive" }),
    });
  };
  const withoutCode = () => { acceptNoCode(); onOpenChange(false); lockStore.lock(); };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!save.isPending) onOpenChange(v); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("setup.title")}</DialogTitle>
          <DialogDescription>{t("setup.description")}</DialogDescription>
        </DialogHeader>
        <QuickCodeField id="first-lock-code" value={code} onChange={(v) => { setCode(v); setInvalid(false); }} onSubmit={saveAndLock} autoFocus invalid={invalid} />
        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button onClick={saveAndLock} disabled={save.isPending || !code} className="w-full">
            {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
            {t("setup.lockNow")}
          </Button>
          <Button variant="ghost" onClick={withoutCode} disabled={save.isPending} className="w-full text-muted-foreground">
            {t("setup.usePassword")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LockController() {
  const { user, logout } = useAuth();
  const member = !!user && user.role !== "guest";
  const lock = useLockState();
  const autoLock = useAutoLock();
  const quick = useQuickCode(member && !lock.locked);
  const [prompt, setPrompt] = React.useState(false);

  const request = React.useCallback(() => {
    if (!member || lockStore.get().locked) return;
    // Ask for a code only when we know there is none (unknown / offline → lock; the password still unlocks).
    if (quick.data && !quick.data.set && !noCodeAccepted()) { setPrompt(true); return; }
    lockStore.lock();
  }, [member, quick.data]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isLockShortcut(e)) return;
      e.preventDefault();
      request();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener(LOCK_REQUEST_EVENT, request);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener(LOCK_REQUEST_EVENT, request);
    };
  }, [request]);

  useAutoLockTimer(member ? autoLock : 0, lock.locked);

  // Unlocked (here or in another tab): back to where the page was.
  const wasLocked = React.useRef(lock.locked);
  React.useEffect(() => {
    if (wasLocked.current && !lock.locked && !lock.signedOut) {
      const top = takeSavedScroll();
      if (top !== null) restoreScroll(top);
    }
    wasLocked.current = lock.locked;
  }, [lock.locked, lock.signedOut]);

  // The 5th wrong code (here or in another tab) ended the session: every tab goes to the sign-in page (App resets the
  // lock state once signed out).
  React.useEffect(() => {
    if (!lock.signedOut) return;
    toast({ title: lockI18n.t("screen.signedOut"), description: lockI18n.t("screen.signedOutDesc") });
    logout();
  }, [lock.signedOut, logout]);

  if (!member) return null;
  return <FirstLockPrompt open={prompt} onOpenChange={setPrompt} />;
}
