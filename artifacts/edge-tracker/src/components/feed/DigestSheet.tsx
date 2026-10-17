import { useCallback, useEffect, useState } from "react";
import { Bell, Eye, Send, Sun, Moon, Mail, MessageCircle, Loader2, Info } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { FilterChip, Pill, Segmented } from "@/components/ds";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { BASE } from "@/lib/api";

type Channel = "none" | "telegram" | "email" | "both";
type DigestSub = {
  enabled: boolean;
  channel: Channel;
  telegramChatId: string;
  email: string;
  sendMorning: boolean;
  sendEvening: boolean;
  tradesWindowHours: number;
};

const DEFAULTS: DigestSub = {
  enabled: false, channel: "none", telegramChatId: "", email: "", sendMorning: true, sendEvening: true, tradesWindowHours: 24,
};

const CHANNEL_LABEL: Record<Channel, string> = { none: "не выбран", telegram: "Telegram", email: "Email", both: "Telegram и Email" };

/** Human summary of the subscription: what arrives, where and when. */
function summary(s: DigestSub): { tone: "up" | "neutral" | "warn"; text: string } {
  if (!s.enabled) return { tone: "neutral", text: "Дайджест выключен" };
  if (s.channel === "none") return { tone: "warn", text: "Включён, но канал доставки не выбран" };
  const when = [s.sendMorning && "утром в 08:00", s.sendEvening && "вечером в 20:00"].filter(Boolean).join(" и ");
  if (!when) return { tone: "warn", text: "Включён, но не выбрано время отправки" };
  return { tone: "up", text: `${CHANNEL_LABEL[s.channel]}, ${when} (UTC+5)` };
}

/**
 * Digest preferences next to the feed itself — the digest carries the latest feed entry
 * (theme, tickers, what works) plus your trades for the chosen window.
 */
export function DigestSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const trader = user?.traderName ?? "";
  const [sub, setSub] = useState<DigestSub>(DEFAULTS);
  const [saved, setSaved] = useState<DigestSub>(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const load = useCallback(async () => {
    if (!trader) return;
    setLoading(true);
    setLoadError(null);
    try {
      // Subject = the signed-in user (server-side); no identity in the query string.
      const r = await fetch(`${BASE}/api/digest/subscription`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { subscription: Partial<DigestSub> & { telegramChatId?: string | null; email?: string | null } | null };
      const s = data.subscription;
      const next: DigestSub = s ? {
        enabled: !!s.enabled,
        channel: (["none", "telegram", "email", "both"].includes(String(s.channel)) ? s.channel : "none") as Channel,
        telegramChatId: s.telegramChatId ?? "",
        email: s.email ?? "",
        sendMorning: s.sendMorning ?? true,
        sendEvening: s.sendEvening ?? true,
        tradesWindowHours: s.tradesWindowHours ?? 24,
      } : DEFAULTS;
      setSub(next);
      setSaved(next);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [trader]);

  useEffect(() => { if (open) { load(); setPreview(null); } }, [open, load]);

  const dirty = JSON.stringify(sub) !== JSON.stringify(saved);
  const needsTg = sub.channel === "telegram" || sub.channel === "both";
  const needsEmail = sub.channel === "email" || sub.channel === "both";
  const emailInvalid = needsEmail && !!sub.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sub.email);
  const canSend = !dirty && sub.enabled && sub.channel !== "none" && (!needsTg || !!sub.telegramChatId) && (!needsEmail || (!!sub.email && !emailInvalid));
  const sum = summary(sub);

  async function save() {
    if (!trader || emailInvalid) return;
    setSaving(true);
    try {
      const r = await fetch(`${BASE}/api/digest/subscription`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: sub.enabled, channel: sub.channel,
          telegramChatId: sub.telegramChatId.trim() || null, email: sub.email.trim() || null,
          sendMorning: sub.sendMorning, sendEvening: sub.sendEvening, tradesWindowHours: sub.tradesWindowHours,
        }),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setSaved(sub);
      toast({ title: "Настройки дайджеста сохранены" });
    } catch (e) {
      toast({ title: "Не удалось сохранить", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function showPreview() {
    if (!trader) return;
    setPreviewLoading(true);
    try {
      const r = await fetch(`${BASE}/api/digest/preview?hours=${sub.tradesWindowHours}`);
      const data = (await r.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!r.ok || !data.text) throw new Error(data.error ?? `HTTP ${r.status}`);
      setPreview(data.text);
    } catch (e) {
      toast({ title: "Предпросмотр недоступен", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  }

  async function sendNow() {
    if (!trader || !canSend) return;
    setSending(true);
    try {
      const r = await fetch(`${BASE}/api/digest/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await r.json().catch(() => ({}))) as { sent?: boolean; channels?: string[]; errors?: string[]; error?: string };
      if (r.ok && data.sent) toast({ title: `Дайджест отправлен: ${(data.channels ?? []).join(", ")}` });
      else if (r.ok && (data.errors ?? []).length) toast({ title: "Ошибка доставки", description: (data.errors ?? []).join("; "), variant: "destructive" });
      else if (r.ok) toast({ title: "Канал доставки не настроен или дайджест выключен", variant: "destructive" });
      else throw new Error(data.error ?? `HTTP ${r.status}`);
    } catch (e) {
      toast({ title: "Не удалось отправить", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
        <SheetHeader className="space-y-1 p-5 pb-3 text-left">
          <SheetTitle className="flex items-center gap-2"><Bell className="h-4 w-4 text-primary" aria-hidden="true" />Дайджест</SheetTitle>
          <SheetDescription>
            Сводка, которую бот присылает тебе: последняя запись ленты (тема, тикеры, что работает) и твои сделки за выбранное окно.
          </SheetDescription>
        </SheetHeader>

        {!trader ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">Дайджест доступен только трейдерам с именем в профиле.</p>
        ) : loading ? (
          <div className="space-y-3 px-5 pb-5" aria-busy="true" aria-label="Загрузка настроек дайджеста">
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-9 w-full rounded-full" />
            <Skeleton className="h-9 w-2/3 rounded-full" />
          </div>
        ) : loadError ? (
          <div className="space-y-3 px-5 pb-5">
            <p className="text-sm text-down">Не удалось загрузить настройки: {loadError}</p>
            <Button variant="outline" onClick={load}>Повторить</Button>
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-5 px-5 pb-5">
            {/* status */}
            <div className="glass-panel flex items-center justify-between gap-3 rounded-xl p-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">{sub.enabled ? "Включён" : "Выключен"}</div>
                <div className="mt-0.5"><Pill tone={sum.tone} dot>{sum.text}</Pill></div>
              </div>
              <Switch checked={sub.enabled} onCheckedChange={(v) => setSub((s) => ({ ...s, enabled: v, channel: v && s.channel === "none" ? "telegram" : s.channel }))} aria-label="Включить дайджест" />
            </div>

            <fieldset className="space-y-2" disabled={!sub.enabled}>
              <legend className="micro-label mb-2">Куда присылать</legend>
              <Segmented<Channel>
                ariaLabel="Канал доставки"
                size="sm"
                value={sub.channel}
                onChange={(v) => setSub((s) => ({ ...s, channel: v }))}
                options={[
                  { value: "telegram", label: <><MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />Telegram</> },
                  { value: "email", label: <><Mail className="h-3.5 w-3.5" aria-hidden="true" />Email</> },
                  { value: "both", label: "Оба" },
                  { value: "none", label: "Никуда" },
                ]}
              />
              {needsTg && (
                <div className="space-y-1 pt-1">
                  <Label htmlFor="digest-tg">Telegram Chat ID</Label>
                  <Input id="digest-tg" value={sub.telegramChatId} onChange={(e) => setSub((s) => ({ ...s, telegramChatId: e.target.value }))} placeholder="-100123456789 или @username" />
                  <p className="flex items-start gap-1 text-xs text-muted-foreground">
                    <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                    Проще всего подключить Telegram в «Настройках» — там бот сам узнает твой Chat ID.
                  </p>
                </div>
              )}
              {needsEmail && (
                <div className="space-y-1 pt-1">
                  <Label htmlFor="digest-email">Email</Label>
                  <Input id="digest-email" type="email" autoComplete="email" aria-invalid={emailInvalid} value={sub.email} onChange={(e) => setSub((s) => ({ ...s, email: e.target.value }))} placeholder="trader@example.com" />
                  {emailInvalid && <p className="text-xs text-down">Проверь адрес — похоже, в нём ошибка.</p>}
                </div>
              )}
            </fieldset>

            <fieldset className="space-y-2" disabled={!sub.enabled}>
              <legend className="micro-label mb-2">Когда (UTC+5)</legend>
              <div className="flex flex-wrap gap-2">
                <FilterChip active={sub.sendMorning} onClick={() => setSub((s) => ({ ...s, sendMorning: !s.sendMorning }))}>
                  <Sun className="h-3.5 w-3.5" aria-hidden="true" />Утро · 08:00
                </FilterChip>
                <FilterChip active={sub.sendEvening} onClick={() => setSub((s) => ({ ...s, sendEvening: !s.sendEvening }))}>
                  <Moon className="h-3.5 w-3.5" aria-hidden="true" />Вечер · 20:00
                </FilterChip>
              </div>
            </fieldset>

            <fieldset className="space-y-2" disabled={!sub.enabled}>
              <legend className="micro-label mb-2">Сделки за последние</legend>
              <Segmented<string>
                ariaLabel="Окно сделок"
                size="sm"
                value={String(sub.tradesWindowHours)}
                onChange={(v) => setSub((s) => ({ ...s, tradesWindowHours: Number(v) }))}
                options={[12, 24, 48, 72].map((h) => ({ value: String(h), label: `${h} ч` }))}
              />
            </fieldset>

            <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <Button onClick={save} disabled={!dirty || saving || emailInvalid}>
                {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
                {saving ? "Сохраняем…" : dirty ? "Сохранить" : "Сохранено"}
              </Button>
              <Button variant="outline" onClick={showPreview} disabled={previewLoading}>
                {previewLoading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Eye aria-hidden="true" />}
                Как он выглядит
              </Button>
              <Button variant="ghost" onClick={sendNow} disabled={!canSend || sending} title={dirty ? "Сначала сохрани изменения" : undefined}>
                {sending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
                Отправить сейчас
              </Button>
            </div>
            {dirty && <p className="-mt-3 text-xs text-muted-foreground">Есть несохранённые изменения.</p>}

            {preview && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="micro-label">Предпросмотр</span>
                  <button type="button" onClick={() => setPreview(null)} className="text-xs text-muted-foreground hover:text-foreground">Скрыть</button>
                </div>
                <pre className="glass-panel max-h-80 overflow-y-auto whitespace-pre-wrap rounded-xl p-3 font-sans text-xs leading-relaxed text-foreground">{preview}</pre>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
