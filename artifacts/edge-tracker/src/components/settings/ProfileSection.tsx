import * as React from "react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, LogOut, Send, ShieldCheck, UserRound, Users, ChevronRight, Palette, Languages } from "lucide-react";
import { Panel, Pill, StatCard } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/contexts/auth-context";
import { authI18n } from "@/i18n/ns/auth";
import { useTheme } from "@/contexts/theme-context";
import { useToast } from "@/hooks/use-toast";
import { ApiError, http } from "@/lib/api/http";
import { isNotFound } from "@/lib/api/errors";
import { STALE } from "@/lib/api/keys";
import { Avatar, Callout, ROLE_LABEL, ROLE_TONE, fmtDaysAgo } from "./shared";
import type { SectionId } from "./SettingsNav";
import { PerformanceReportPanel } from "@/components/propreports/PerformanceReportPanel";
import { LanguageSelect } from "@/i18n/language-switcher";
import { commonI18n } from "@/i18n/ns/common";
import { fmtCount, fmtDate } from "@/lib/format";

/** Interface language (also in the top bar and the login screen); saved to the profile by i18n/locale-sync. */
function LanguagePanel() {
  const { t } = commonI18n.useT();
  return (
    <Panel title={t("language.interface")} description={t("language.hint")} icon={Languages}>
      <label htmlFor="profile-language" className="sr-only">{t("language.interface")}</label>
      <LanguageSelect id="profile-language" />
    </Panel>
  );
}

export type MyProfile = {
  id: number;
  name: string;
  role: string;
  theme: string;
  createdAt: string | null;
  telegramLinked: boolean;
  telegramLinkedAt: string | null;
  tgNotificationsEnabled: boolean;
  assignedCurator: string | null;
  assignedRiskManager: string | null;
  assignedMentor: string | null;
  stats: { total: number; last30: number; firstTrade: string | null; lastTrade: string | null };
  wards: string[];
};

export const PROFILE_QUERY_KEY = ["users", "me", "profile"] as const;

export function useMyProfile(enabled: boolean) {
  return useQuery<MyProfile | null>({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: async ({ signal }) => {
      try {
        return await http.get<MyProfile>("/api/users/me/profile", { signal });
      } catch (e) {
        // Endpoint not deployed yet → render the profile from the session only.
        if (isNotFound(e)) return null;
        throw e;
      }
    },
    enabled,
    staleTime: STALE.short,
  });
}

function TeamLine({ label, name }: { label: string; name: string | null | undefined }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      {name ? (
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
          <Avatar name={name} role="curator" size="sm" />
          <span className="truncate">{name}</span>
        </span>
      ) : (
        <span className="text-sm text-muted-foreground">не назначен</span>
      )}
    </div>
  );
}

function PasswordSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { logout, user } = useAuth();
  const { toast } = useToast();
  const { t: ta } = authI18n.useT();
  // Policy by role (API lib/security/passwordPolicy): PIN ≥ 6 for traders, password ≥ 10 for curators/admins.
  const min = user?.secretMin ?? (user?.role === "curator" || user?.role === "admin" ? 10 : 6);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = next.length > 0 && next.length < min;
  const mismatch = repeat.length > 0 && repeat !== next;
  const valid = current.length > 0 && next.length >= min && next === repeat && next !== current;

  function reset() { setCurrent(""); setNext(""); setRepeat(""); setError(null); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      try {
        await http.post("/api/users/me/password", { currentPassword: current, newPassword: next });
      } catch (err) {
        if (!(err instanceof ApiError) || err.isNetwork) throw err;
        if (err.status === 404) { setError("Смена пароля пока недоступна на сервере — обратитесь к куратору."); return; }
        if (err.status === 429) { setError("Слишком много попыток. Попробуйте через 15 минут."); return; }
        const msg = err.field<string>("error") || `Ошибка (HTTP ${err.status})`;
        setError(/incorrect/i.test(msg) ? "Текущий пароль неверный" : msg);
        return;
      }
      reset();
      onOpenChange(false);
      toast({ title: "Пароль изменён", description: "Все сессии завершены — войдите с новым паролем." });
      logout();
    } catch {
      setError("Сетевая ошибка");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!saving) { onOpenChange(v); if (!v) reset(); } }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
        <form onSubmit={submit} className="flex flex-1 flex-col" autoComplete="off">
          <SheetHeader className="px-5 pb-2 pt-5 text-left">
            <SheetTitle>Смена пароля</SheetTitle>
            <SheetDescription>После смены все активные сессии завершатся, включая эту.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-5 py-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pw-current" className="text-xs text-muted-foreground">Текущий пароль</label>
              <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pw-new" className="text-xs text-muted-foreground">Новый пароль</label>
              <Input id="pw-new" type="password" autoComplete="new-password" value={next} maxLength={200}
                aria-invalid={tooShort} aria-describedby={tooShort ? "pw-new-err" : undefined}
                onChange={(e) => setNext(e.target.value)} />
              {tooShort && <p id="pw-new-err" className="text-xs text-down">{ta("forced.tooShort", { min })}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pw-repeat" className="text-xs text-muted-foreground">Повторите новый пароль</label>
              <Input id="pw-repeat" type="password" autoComplete="new-password" value={repeat} maxLength={200}
                aria-invalid={mismatch} aria-describedby={mismatch ? "pw-repeat-err" : undefined}
                onChange={(e) => setRepeat(e.target.value)} />
              {mismatch && <p id="pw-repeat-err" className="text-xs text-down">Пароли не совпадают</p>}
            </div>
            {error && <p role="alert" className="rounded-xl bg-down/10 px-3 py-2 text-sm text-down">{error}</p>}
          </div>
          <SheetFooter className="mt-auto flex-row justify-end gap-2 border-t border-border px-5 py-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Отмена</Button>
            <Button type="submit" disabled={!valid || saving}>{saving ? "Сохранение…" : "Сменить пароль"}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function ProfileSection({ onNavigate }: { onNavigate: (id: SectionId) => void }) {
  const { user, can, logout } = useAuth();
  const { themeLabel } = useTheme();
  const isMember = !!user?.traderName && user.role !== "guest";
  const { data: profile, isLoading } = useMyProfile(isMember);
  const [pwOpen, setPwOpen] = useState(false);
  const [logoutAllOpen, setLogoutAllOpen] = useState(false);

  if (!isMember) {
    return (
      <div className="flex flex-col gap-4">
        <Panel title="Профиль" icon={UserRound}>
          <Callout icon={UserRound}>Вы в гостевом режиме. Войдите под своим именем, чтобы настроить профиль, уведомления и торговые параметры.</Callout>
        </Panel>
        <LanguagePanel />
      </div>
    );
  }

  const name = user!.traderName!;
  const role = profile?.role ?? user!.role;
  const stats = profile?.stats;
  // Staff who don't trade (partners / curators with no own trades) don't need empty trade tiles and an empty
  // broker report on their profile; a trader always sees them (an empty state is the useful hint there).
  const trades = role === "trader" || isLoading || (stats?.total ?? 0) > 0;
  const staff = role !== "trader";

  return (
    <div className="flex flex-col gap-4">
      {/* Identity hero */}
      <Panel>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar name={name} role={role} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-xl font-semibold text-foreground">{name}</h2>
                <Pill tone={ROLE_TONE[role] ?? "accent"}>{ROLE_LABEL[role] ?? role}</Pill>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {profile?.createdAt ? `В команде с ${fmtDate(profile.createdAt)}` : "Участник команды WS_LEXX"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onNavigate("integrations")} className="chip inline-flex min-h-8 items-center gap-1.5 px-3 text-xs font-medium">
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              {profile == null ? "Telegram" : profile.telegramLinked ? "Telegram подключён" : "Подключить Telegram"}
              <ChevronRight className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => onNavigate("appearance")} className="chip inline-flex min-h-8 items-center gap-1.5 px-3 text-xs font-medium">
              <Palette className="h-3.5 w-3.5" aria-hidden="true" /> Тема: {themeLabel}
            </button>
          </div>
        </div>
      </Panel>

      <LanguagePanel />

      {/* Activity tiles */}
      {trades && <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-2xl" />)
        ) : (
          <>
            <StatCard label="Сделок в журнале" value={stats ? fmtCount(stats.total) : "—"}
              hint={stats?.firstTrade ? `с ${fmtDate(stats.firstTrade)}` : undefined} />
            <StatCard label="За 30 дней" value={stats ? fmtCount(stats.last30) : "—"}
              tone={stats && stats.last30 > 0 ? "accent" : "neutral"} hint={stats ? commonI18n.t("units.tradesWord", { count: stats.last30 }) : "сделок"} />
            <StatCard label="Последняя сделка" value={stats ? fmtDaysAgo(stats.lastTrade) : "—"}
              hint={stats?.lastTrade ? fmtDate(stats.lastTrade) : undefined} />
          </>
        )}
      </div>}

      {/* Broker statistics from PropReports (Trade Performance report) */}
      {trades && <PerformanceReportPanel trader={name} compact />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Моя команда" description={staff ? "Назначения и подопечные" : "Кто ведёт вас на деске"} icon={Users} fill>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 rounded-xl" />)}</div>
          ) : profile ? (
            <div className="divide-y divide-border">
              {(!staff || profile.assignedCurator) && <TeamLine label="Куратор" name={profile.assignedCurator} />}
              {(!staff || profile.assignedRiskManager) && <TeamLine label="Риск-менеджер" name={profile.assignedRiskManager} />}
              {(!staff || profile.assignedMentor) && <TeamLine label="Ментор" name={profile.assignedMentor} />}
              {can("users.read.team") && (
                <div className="pt-3">
                  <div className="micro-label mb-2">Мои подопечные</div>
                  {profile.wards.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {profile.wards.map((w) => <Pill key={w}>{w}</Pill>)}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Никто не закреплён. Назначения — в разделе «Команда».</p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Назначения появятся после обновления сервера.</p>
          )}
        </Panel>

        <Panel title="Безопасность" description="Пароль и активные сессии" icon={ShieldCheck} fill>
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => setPwOpen(true)}
              className="lift flex items-center justify-between gap-3 rounded-xl bg-[var(--glass-bg)] px-3 py-3 text-left hover:bg-[var(--glass-hover-bg)]">
              <span className="flex items-center gap-3">
                <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span>
                  <span className="block text-sm font-medium text-foreground">Сменить пароль</span>
                  <span className="block text-xs text-muted-foreground">Нужен текущий пароль</span>
                </span>
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setLogoutAllOpen(true)}
              className="lift flex items-center justify-between gap-3 rounded-xl bg-[var(--glass-bg)] px-3 py-3 text-left hover:bg-[var(--glass-hover-bg)]">
              <span className="flex items-center gap-3">
                <LogOut className="h-4 w-4 text-down" aria-hidden="true" />
                <span>
                  <span className="block text-sm font-medium text-foreground">Выйти на всех устройствах</span>
                  <span className="block text-xs text-muted-foreground">Завершит все сессии, включая эту</span>
                </span>
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </button>
          </div>
        </Panel>
      </div>

      <PasswordSheet open={pwOpen} onOpenChange={setPwOpen} />

      <AlertDialog open={logoutAllOpen} onOpenChange={setLogoutAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Выйти на всех устройствах?</AlertDialogTitle>
            <AlertDialogDescription>Все активные сессии (телефон, другие браузеры и эта вкладка) будут завершены.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => logout()} className="bg-destructive text-destructive-foreground hover:brightness-110">Выйти везде</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
