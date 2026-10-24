/**
 * Settings → Безопасность: the screen lock «Заблокировать». Quick-unlock code (set / change / remove; stored hashed on
 * the server, never shown back), auto-lock after N idle minutes (this browser) and the shortcut.
 */
import { useState } from "react";
import { KeyRound, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { Panel, Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QuickCodeField, isQuickCodeValid } from "@/components/shared/quick-code-field";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { fmtDate } from "@/lib/format";
import { AUTO_LOCK_OPTIONS, LOCK_KEYS, type AutoLockMinutes } from "@/lib/lock/lock-model";
import { requestLock, useAutoLock, writeAutoLock } from "@/lib/lock/lock-store";
import { useQuickCode, useRemoveQuickCode, useSaveQuickCode } from "@/lib/lock/quick-code-api";
import { lockI18n } from "@/i18n/ns/lock";
import { commonI18n } from "@/i18n/ns/common";
import { settingsI18n } from "@/i18n/ns/settings";
import { Callout, InlineError, SettingRow } from "./shared";

function QuickCodePanel() {
  const { t } = lockI18n.useT();
  const { toast } = useToast();
  const status = useQuickCode();
  const save = useSaveQuickCode();
  const remove = useRemoveQuickCode();
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState("");
  const [invalid, setInvalid] = useState(false);

  const close = () => { setEditing(false); setCode(""); setInvalid(false); };
  const submit = () => {
    if (!isQuickCodeValid(code)) { setInvalid(true); return; }
    save.mutate(code, {
      onSuccess: () => { close(); toast({ title: t("code.saved") }); },
      onError: () => toast({ title: t("code.failed"), variant: "destructive" }),
    });
  };
  const drop = () => remove.mutate(undefined, {
    onSuccess: () => toast({ title: t("code.removed") }),
    onError: () => toast({ title: t("code.failed"), variant: "destructive" }),
  });

  const set = status.data?.set ?? false;
  const kind = status.data?.kind;
  return (
    <Panel title={t("code.title")} description={t("code.hint")} icon={KeyRound}>
      {status.isError ? <InlineError message={commonI18n.t("states.loadFailed")} onRetry={() => void status.refetch()} /> : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {status.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" /> : set ? (
              <>
                <Pill tone="up">{t("code.set")}</Pill>
                {kind && <span className="text-muted-foreground">{t(kind === "digits" ? "code.kindDigits" : "code.kindPhrase")}</span>}
                {status.data?.setAt && <span className="text-muted-foreground">· {t("code.setOn", { date: fmtDate(status.data.setAt, "medium") })}</span>}
              </>
            ) : (
              <span className="text-muted-foreground">{t("code.notSet")}</span>
            )}
          </div>
          {editing ? (
            <div className="flex max-w-md flex-col gap-3">
              <QuickCodeField id="quick-code-new" value={code} onChange={(v) => { setCode(v); setInvalid(false); }} onSubmit={submit} autoFocus invalid={invalid} />
              <div className="flex flex-wrap gap-2">
                <Button onClick={submit} disabled={save.isPending || !code}>
                  {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
                  {t("code.save")}
                </Button>
                <Button variant="ghost" onClick={close} disabled={save.isPending}>{t("code.cancel")}</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant={set ? "outline" : "default"} onClick={() => setEditing(true)} disabled={status.isLoading}>
                {set ? t("code.change") : t("code.setAction")}
              </Button>
              {set && (
                <Button variant="ghost" onClick={drop} disabled={remove.isPending} className="text-down hover:text-down">
                  {remove.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
                  {t("code.remove")}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function LockPanel() {
  const { t } = lockI18n.useT();
  const auto = useAutoLock();
  const minutes = (m: number) => commonI18n.t("units.minutes", { count: m });
  return (
    <Panel title={t("button")} description={t("how")} icon={LockKeyhole} actions={
      <Button variant="outline" size="sm" onClick={requestLock} className="gap-1.5">
        <LockKeyhole aria-hidden="true" /> {t("button")}
      </Button>
    }>
      <div className="divide-y divide-[var(--field-border)]">
        <SettingRow label={t("autoLock.title")} hint={t("autoLock.hint")} htmlFor="auto-lock">
          <Select value={String(auto)} onValueChange={(v) => writeAutoLock(Number(v) as AutoLockMinutes)}>
            <SelectTrigger id="auto-lock" className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {AUTO_LOCK_OPTIONS.map((m) => (
                <SelectItem key={m} value={String(m)}>{m === 0 ? t("autoLock.off") : minutes(m)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow label={t("shortcut.title")} hint={t("shortcut.hint")}>
          <span className="flex items-center gap-1">{LOCK_KEYS.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
        </SettingRow>
      </div>
    </Panel>
  );
}

export function SecuritySection() {
  const { user } = useAuth();
  const { t: ts } = settingsI18n.useT();
  if (!user || user.role === "guest") {
    return <Callout icon={ShieldCheck}>{ts("profile.guest")}</Callout>;
  }
  return (
    <div className="flex flex-col gap-4">
      <QuickCodePanel />
      <LockPanel />
    </div>
  );
}

