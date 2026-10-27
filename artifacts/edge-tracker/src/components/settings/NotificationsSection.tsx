import { useEffect, useState } from "react";
import { TelegramConnect } from "./IntegrationsSection";
import { Bell, BellOff, Medal, ChevronRight } from "lucide-react";
import { Panel } from "@/components/ds";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { ApiError, http } from "@/lib/api/http";
import { humanizeApiError } from "@/lib/api/errors";
import { Callout, SettingRow } from "./shared";
import { useMyProfile } from "./ProfileSection";
import type { SectionId } from "./SettingsNav";
import { settingsI18n } from "@/i18n/ns/settings";
import { commonI18n } from "@/i18n/ns/common";
import { gamificationI18n } from "@/i18n/ns/gamification";

/** Daily loop in the bot (morning focus, evening card, contract alerts): users.settings.dailyTelegram, absent = on. */
function DailyTelegramRow({ disabled }: { disabled: boolean }) {
  const { t } = settingsI18n.useT();
  const { t: tc } = commonI18n.useT();
  const { toast } = useToast();
  const [on, setOn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    http.get<{ settings?: { dailyTelegram?: unknown } } | null>("/api/users/me/settings")
      .then((d) => setOn(d?.settings?.dailyTelegram !== false))
      .catch(() => setOn(true));
  }, []);

  async function toggle(v: boolean) {
    const prev = on;
    setOn(v);
    setSaving(true);
    try {
      await http.put("/api/users/me/settings", { dailyTelegram: v });
      toast({ title: v ? t("tgAlerts.dailyOn") : t("tgAlerts.dailyOff") });
    } catch (e) {
      setOn(prev);
      toast({ title: e instanceof ApiError && !e.isNetwork ? t("tgAlerts.saveError") : tc("states.networkError"), description: e instanceof ApiError && !e.isNetwork ? humanizeApiError(e) : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (on === null) return <Skeleton className="h-14 rounded-xl" />;
  return (
    <SettingRow label={t("tgAlerts.daily")} htmlFor="tg-daily" hint={t("tgAlerts.dailyHint")}>
      <Switch id="tg-daily" checked={on && !disabled} disabled={saving || disabled} onCheckedChange={toggle} />
    </SettingRow>
  );
}

function TelegramAlertsPanel({ onNavigate }: { onNavigate: (id: SectionId) => void }) {
  const { t } = settingsI18n.useT();
  const { t: tc } = commonI18n.useT();
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: profile, isLoading } = useMyProfile(!!user?.traderName && user.role !== "guest");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [toggling, setToggling] = useState(false);
  const name = user?.traderName ?? "";

  useEffect(() => {
    if (!name) return;
    http.get<{ enabled?: unknown } | null>("/api/users/tg-notifications", { query: { name } })
      .catch(() => null)
      .then((d) => { if (d && typeof d.enabled === "boolean") setEnabled(d.enabled); else setEnabled(true); })
      .catch(() => setEnabled(true));
  }, [name]);

  async function toggle(v: boolean) {
    setToggling(true);
    const prev = enabled;
    setEnabled(v);
    try {
      try {
        await http.patch("/api/users/tg-notifications", { name, enabled: v });
      } catch (e) {
        if (!(e instanceof ApiError) || e.isNetwork) throw e;
        setEnabled(prev);
        toast({ title: t("tgAlerts.saveError"), description: humanizeApiError(e), variant: "destructive" });
        return;
      }
      toast({ title: v ? t("tgAlerts.enabled") : t("tgAlerts.paused") });
    } catch {
      setEnabled(prev);
      toast({ title: tc("states.networkError"), variant: "destructive" });
    } finally {
      setToggling(false);
    }
  }

  const linked = profile?.telegramLinked;

  return (
    <Panel title={t("tgAlerts.title")} description={t("tgAlerts.description")} icon={enabled === false ? BellOff : Bell}>
      {isLoading || enabled === null ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <SettingRow label={t("tgAlerts.send")} htmlFor="tg-alerts"
            hint={enabled
              ? profile && !linked ? t("tgAlerts.onNotLinked") : t("tgAlerts.onLinked")
              : profile && !linked ? t("tgAlerts.offNotLinked") : t("tgAlerts.offLinked")}>
            <Switch id="tg-alerts" checked={!!enabled} disabled={toggling} onCheckedChange={toggle} />
          </SettingRow>
          <DailyTelegramRow disabled={!enabled} />
          {profile && !linked && (
            <button type="button" onClick={() => document.getElementById("settings-telegram")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="lift flex items-center justify-between gap-3 rounded-xl bg-[hsl(var(--chart-3)/0.12)] px-3 py-2.5 text-left text-sm">
              <span className="text-foreground">{t("tgAlerts.notLinked")}</span>
              <span className="flex shrink-0 items-center gap-1 text-primary">{t("tgAlerts.link")} <ChevronRight className="h-4 w-4" aria-hidden="true" /></span>
            </button>
          )}
        </div>
      )}
    </Panel>
  );
}

/**
 * Recognition (lib/gamification): new achievement tiers, streaks and titles go to the desk feed (and the Telegram group
 * when it is connected) unless the trader hides them — users.settings.shareAchievements, absent = on.
 */
function ShareAchievementsPanel() {
  const { t } = gamificationI18n.useT();
  const { t: tc } = commonI18n.useT();
  const { toast } = useToast();
  const [on, setOn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    http.get<{ settings?: { shareAchievements?: unknown } } | null>("/api/users/me/settings")
      .then((d) => setOn(d?.settings?.shareAchievements !== false))
      .catch(() => setOn(true));
  }, []);

  async function toggle(v: boolean) {
    const prev = on;
    setOn(v);
    setSaving(true);
    try {
      await http.put("/api/users/me/settings", { shareAchievements: v });
      toast({ title: v ? t("recognition.on") : t("recognition.off") });
    } catch (e) {
      setOn(prev);
      toast({ title: e instanceof ApiError && !e.isNetwork ? t("recognition.failed") : tc("states.networkError"), description: e instanceof ApiError && !e.isNetwork ? humanizeApiError(e) : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel title={t("recognition.panel")} icon={Medal}>
      {on === null ? <Skeleton className="h-14 rounded-xl" /> : (
        <SettingRow label={t("recognition.setting")} htmlFor="share-achievements" hint={t("recognition.settingHint")}>
          <Switch id="share-achievements" checked={on} disabled={saving} onCheckedChange={toggle} />
        </SettingRow>
      )}
    </Panel>
  );
}

export function NotificationsSection({ onNavigate }: { onNavigate: (id: SectionId) => void }) {
  const { user, isCurator } = useAuth();
  const { t } = settingsI18n.useT();
  if (!user?.traderName || user.role === "guest") {
    return (
      <Panel title={t("sections.notifications.label")} icon={Bell}>
        <Callout>{t("tgAlerts.guest")}</Callout>
      </Panel>
    );
  }
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <TelegramAlertsPanel onNavigate={onNavigate} />
      {/* The Telegram link itself (was «Интеграции»): personal, so it lives with the alerts it powers. */}
      <div id="settings-telegram" className="scroll-mt-4"><TelegramConnect /></div>
      {!isCurator && <ShareAchievementsPanel />}
      <Callout icon={Bell}>{t("tgAlerts.about")}</Callout>
    </div>
  );
}
