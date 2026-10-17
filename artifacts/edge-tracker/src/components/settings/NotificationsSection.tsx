
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, BellOff, Eye, Mail, Send, ChevronRight } from "lucide-react";
import { Panel, Pill, Segmented } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { ApiError, http } from "@/lib/api/http";
import { humanizeApiError } from "@/lib/api/errors";
import { fmtDate } from "@/lib/format";
import { Callout, InlineError, SettingRow } from "./shared";
import { useMyProfile } from "./ProfileSection";
import type { SectionId } from "./SettingsNav";

/** Digest send times — must match MORNING_UTC_HOUR / EVENING_UTC_HOUR in api-server lib/digest.ts. */
const DIGEST_MORNING_UTC = 9;
const DIGEST_EVENING_UTC = 18;
function digestLocalTime(utcHour: number): string {
  const d = new Date();
  d.setUTCHours(utcHour, 0, 0, 0);
  return fmtDate(d, "time");
}

type DigestSub = {
  enabled: boolean;
  channel: string;
  telegramChatId: string | null;
  email: string | null;
  sendMorning: boolean;
  sendEvening: boolean;
  tradesWindowHours: number;
};

const EMPTY_SUB: DigestSub = {
  enabled: false, channel: "none", telegramChatId: "", email: "", sendMorning: true, sendEvening: true, tradesWindowHours: 24,
};

type Channel = "none" | "telegram" | "email" | "both";

function DigestPanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const trader = user?.traderName ?? "";
  const [sub, setSub] = useState<DigestSub>(EMPTY_SUB);
  const [savedSub, setSavedSub] = useState<DigestSub>(EMPTY_SUB);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  const fetchSub = useCallback(async () => {
    if (!trader) return;
    setState("loading");
    try {
      const data = await http.get<{ subscription: DigestSub | null }>("/api/digest/subscription", { query: { trader } });
      const s = data.subscription
        ? { ...data.subscription, telegramChatId: data.subscription.telegramChatId ?? "", email: data.subscription.email ?? "" }
        : EMPTY_SUB;
      setSub(s); setSavedSub(s); setState("ready");
    } catch {
      setState("error");
    }
  }, [trader]);

  useEffect(() => { fetchSub(); }, [fetchSub]);

  const dirty = useMemo(() => JSON.stringify(sub) !== JSON.stringify(savedSub), [sub, savedSub]);
  const needsTg = sub.channel === "telegram" || sub.channel === "both";
  const needsEmail = sub.channel === "email" || sub.channel === "both";
  const emailInvalid = needsEmail && !!sub.email && !/^\S+@\S+\.\S+$/.test(sub.email);
  const canSend = sub.channel !== "none" && sub.enabled && (!needsTg || !!sub.telegramChatId) && (!needsEmail || !!sub.email);

  async function handleSave() {
    if (!trader || emailInvalid) return;
    setSaving(true);
    try {
      try {
        await http.put("/api/digest/subscription", {
          trader, enabled: sub.enabled, channel: sub.channel,
          telegramChatId: sub.telegramChatId || null, email: sub.email || null,
          sendMorning: sub.sendMorning, sendEvening: sub.sendEvening, tradesWindowHours: sub.tradesWindowHours,
        });
      } catch (e) {
        if (!(e instanceof ApiError) || e.isNetwork) throw e;
        toast({ title: humanizeApiError(e, "Ошибка сохранения"), variant: "destructive" });
        return;
      }
      setSavedSub(sub);
      toast({ title: "Настройки дайджеста сохранены" });
    } catch {
      toast({ title: "Сетевая ошибка", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleSendNow() {
    if (!trader) return;
    setSending(true);
    try {
      type SendResp = { sent?: boolean; channels?: string[]; errors?: string[]; error?: string };
      let ok = true;
      let data: SendResp;
      try {
        data = (await http.post<SendResp | null>("/api/digest/send", { trader })) ?? {};
      } catch (e) {
        if (!(e instanceof ApiError) || e.isNetwork) throw e;
        ok = e.status < 300;
        data = ok ? {} : { error: e.field<string>("error") };
      }
      if (ok && data.sent) toast({ title: `Дайджест отправлен: ${(data.channels ?? []).join(", ")}` });
      else if (ok && (data.errors ?? []).length > 0) toast({ title: `Ошибка доставки: ${(data.errors ?? []).join("; ")}`, variant: "destructive" });
      else if (ok) toast({ title: "Канал доставки не настроен или доставка отключена", variant: "destructive" });
      else toast({ title: data.error ?? "Ошибка отправки", variant: "destructive" });
    } catch {
      toast({ title: "Сетевая ошибка", variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  async function handlePreview() {
    if (!trader) return;
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewText(null);
    try {
      type PreviewResp = { text?: string; error?: string };
      let status = 200;
      let data: PreviewResp;
      try {
        data = (await http.get<PreviewResp | null>("/api/digest/preview", { query: { trader, hours: sub.tradesWindowHours } })) ?? {};
      } catch (e) {
        if (!(e instanceof ApiError) || e.isNetwork) throw e;
        status = e.status;
        data = { error: e.field<string>("error") };
      }
      if (status < 300 && data.text) setPreviewText(data.text);
      else setPreviewText(`Не удалось построить предпросмотр: ${data.error ?? `HTTP ${status}`}`);
    } catch {
      setPreviewText("Сетевая ошибка");
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <Panel
      title="Дайджест сделок"
      description="Сводка ваших сделок утром и вечером — в Telegram или на почту"
      icon={Mail}
      actions={state === "ready" ? <Pill tone={savedSub.enabled && savedSub.channel !== "none" ? "up" : "neutral"} dot>{savedSub.enabled && savedSub.channel !== "none" ? "Включён" : "Выключен"}</Pill> : undefined}
    >
      {state === "loading" && (
        <div className="space-y-3" aria-busy="true" aria-label="Загрузка настроек дайджеста">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-xl" />)}
        </div>
      )}
      {state === "error" && <InlineError message="Не удалось загрузить настройки дайджеста" onRetry={fetchSub} />}
      {state === "ready" && (
        <div className="flex flex-col">
          <div className="divide-y divide-border">
            <SettingRow label="Получать дайджест" hint="Главный переключатель — без него ничего не отправляется" htmlFor="digest-enabled">
              <Switch id="digest-enabled" checked={sub.enabled} onCheckedChange={(v) => setSub((s) => ({ ...s, enabled: v }))} />
            </SettingRow>
            <SettingRow label="Канал доставки">
              <Segmented<Channel> ariaLabel="Канал доставки" size="sm" value={sub.channel as Channel}
                onChange={(v) => setSub((s) => ({ ...s, channel: v }))}
                options={[{ value: "none", label: "Нет" }, { value: "telegram", label: "Telegram" }, { value: "email", label: "Email" }, { value: "both", label: "Оба" }]} />
            </SettingRow>
            {needsTg && (
              <SettingRow label="Telegram Chat ID" hint="Напишите боту /start, затем укажите ID чата (например -100123456789 или @username)" htmlFor="digest-tg-chat">
                <Input id="digest-tg-chat" value={sub.telegramChatId ?? ""} onChange={(e) => setSub((s) => ({ ...s, telegramChatId: e.target.value }))}
                  placeholder="-100123456789" className="w-full sm:w-64" />
              </SettingRow>
            )}
            {needsEmail && (
              <SettingRow label="Email" htmlFor="digest-email" hint={emailInvalid ? <span className="text-down">Проверьте адрес</span> : undefined}>
                <Input id="digest-email" type="email" autoComplete="email" value={sub.email ?? ""} aria-invalid={emailInvalid}
                  onChange={(e) => setSub((s) => ({ ...s, email: e.target.value }))} placeholder="trader@example.com" className="w-full sm:w-64" />
              </SettingRow>
            )}
            <SettingRow label="Утренний дайджест" hint={`${digestLocalTime(DIGEST_MORNING_UTC)} по вашему времени — до открытия рынка`} htmlFor="digest-morning">
              <Switch id="digest-morning" checked={sub.sendMorning} onCheckedChange={(v) => setSub((s) => ({ ...s, sendMorning: v }))} />
            </SettingRow>
            <SettingRow label="Вечерний дайджест" hint={`${digestLocalTime(DIGEST_EVENING_UTC)} по вашему времени — сделки за выбранное окно`} htmlFor="digest-evening">
              <Switch id="digest-evening" checked={sub.sendEvening} onCheckedChange={(v) => setSub((s) => ({ ...s, sendEvening: v }))} />
            </SettingRow>
            <SettingRow label="Окно сделок" hint="За какой период собирать сделки">
              <Segmented<string> ariaLabel="Окно сделок" size="sm" value={String(sub.tradesWindowHours)}
                onChange={(v) => setSub((s) => ({ ...s, tradesWindowHours: Number(v) }))}
                options={[12, 24, 48].map((h) => ({ value: String(h), label: `${h} ч` }))} />
            </SettingRow>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {dirty ? "Есть несохранённые изменения" : "Все изменения сохранены"}
            </span>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={handlePreview} className="gap-1.5"><Eye className="h-3.5 w-3.5" aria-hidden="true" /> Предпросмотр</Button>
              <Button size="sm" variant="outline" onClick={handleSendNow} disabled={sending || !canSend || dirty} className="gap-1.5"
                title={dirty ? "Сначала сохраните изменения" : !canSend ? "Включите дайджест и заполните канал" : undefined}>
                <Send className="h-3.5 w-3.5" aria-hidden="true" /> {sending ? "Отправка…" : "Отправить сейчас"}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving || !dirty || emailInvalid}>{saving ? "Сохранение…" : "Сохранить"}</Button>
            </div>
          </div>
        </div>
      )}

      <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
          <SheetHeader className="px-5 pb-2 pt-5 text-left">
            <SheetTitle>Предпросмотр дайджеста</SheetTitle>
            <SheetDescription>Так выглядит сообщение за последние {sub.tradesWindowHours} ч. Ничего не отправляется.</SheetDescription>
          </SheetHeader>
          <div className="px-5 pb-5">
            {previewLoading ? (
              <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-4 rounded-full" />)}</div>
            ) : (
              <pre className="whitespace-pre-wrap rounded-xl bg-[var(--glass-bg)] p-4 font-sans text-sm leading-relaxed text-foreground">{previewText}</pre>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </Panel>
  );
}

function TelegramAlertsPanel({ onNavigate }: { onNavigate: (id: SectionId) => void }) {
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
        toast({ title: "Ошибка сохранения", description: humanizeApiError(e), variant: "destructive" });
        return;
      }
      toast({ title: v ? "Оповещения включены" : "Оповещения на паузе" });
    } catch {
      setEnabled(prev);
      toast({ title: "Сетевая ошибка", variant: "destructive" });
    } finally {
      setToggling(false);
    }
  }

  const linked = profile?.telegramLinked;

  return (
    <Panel title="Оповещения в Telegram" description="Новые идеи, ревью куратора, комментарии" icon={enabled === false ? BellOff : Bell}>
      {isLoading || enabled === null ? (
        <Skeleton className="h-10 rounded-xl" />
      ) : (
        <div className="flex flex-col gap-3">
          <SettingRow label="Присылать оповещения" htmlFor="tg-alerts"
            hint={enabled
              ? profile && !linked ? "Включено, но придут только после привязки Telegram" : "Вы получаете уведомления в боте"
              : profile && !linked ? "Выключено" : "Пауза: бот привязан, но молчит (удобно в отпуске или при тестах)"}>
            <Switch id="tg-alerts" checked={!!enabled} disabled={toggling} onCheckedChange={toggle} />
          </SettingRow>
          {profile && !linked && (
            <button type="button" onClick={() => onNavigate("integrations")}
              className="lift flex items-center justify-between gap-3 rounded-xl bg-[hsl(var(--chart-3)/0.12)] px-3 py-2.5 text-left text-sm">
              <span className="text-foreground">Telegram не привязан — оповещения некуда отправлять</span>
              <span className="flex shrink-0 items-center gap-1 text-primary">Привязать <ChevronRight className="h-4 w-4" aria-hidden="true" /></span>
            </button>
          )}
        </div>
      )}
    </Panel>
  );
}

export function NotificationsSection({ onNavigate }: { onNavigate: (id: SectionId) => void }) {
  const { user } = useAuth();
  if (!user?.traderName || user.role === "guest") {
    return (
      <Panel title="Уведомления" icon={Bell}>
        <Callout>Войдите под своим именем, чтобы настроить дайджест и оповещения.</Callout>
      </Panel>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <DigestPanel />
      <div className="flex flex-col gap-4">
        <TelegramAlertsPanel onNavigate={onNavigate} />
        <Callout icon={Bell}>
          Дайджест собирает ваши сделки за выбранное окно. Утренний — для плана на день, вечерний — для разбора с куратором.
          Посмотреть содержимое можно через «Предпросмотр» — он ничего не отправляет.
        </Callout>
      </div>
    </div>
  );
}
