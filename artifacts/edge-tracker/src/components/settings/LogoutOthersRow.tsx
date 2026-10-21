import { useState } from "react";
import { ChevronRight, LogOut } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { commonI18n } from "@/i18n/ns/common";
import { settingsI18n } from "@/i18n/ns/settings";

/**
 * Settings → Profile → «Выйти на других устройствах» (wave 1, item 1.10). The menu «Выйти» signs out only this device;
 * this row ends every other session (server: POST /auth/logout-all bumps token_version) and keeps this one signed in
 * with a fresh token, then says so in a toast.
 */
export function LogoutOthersRow() {
  const { logoutOthers } = useAuth();
  const { t } = settingsI18n.useT();
  const { t: tc } = commonI18n.useT();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    const ok = await logoutOthers();
    setBusy(false);
    setOpen(false);
    toast(ok
      ? { title: t("profile.logoutOthersDone"), description: t("profile.logoutOthersDoneDesc") }
      : { title: t("profile.logoutOthersFailed"), variant: "destructive" });
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="lift flex items-center justify-between gap-3 rounded-xl bg-[var(--glass-bg)] px-3 py-3 text-left hover:bg-[var(--glass-hover-bg)]">
        <span className="flex items-center gap-3">
          <LogOut className="h-4 w-4 text-down" aria-hidden="true" />
          <span>
            <span className="block text-sm font-medium text-foreground">{t("profile.logoutAll")}</span>
            <span className="block text-xs text-muted-foreground">{t("profile.logoutAllHint")}</span>
          </span>
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("profile.logoutAllTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("profile.logoutAllDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void run(); }}
              className="bg-destructive text-destructive-foreground hover:brightness-110">
              {t("profile.logoutEverywhere")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
