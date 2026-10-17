import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Copy, ExternalLink, Link2, Radio, RefreshCw, Send, Unlink } from "lucide-react";
import { Panel, Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { BASE } from "@/lib/api";
import { Callout, InlineError, fmtDate, readApiError } from "./shared";
import { useTeam } from "./team-api";
import { PROFILE_QUERY_KEY } from "./ProfileSection";

type TgStatus = { connected: boolean; linked_at: string | null };
type LinkData = { token: string; deep_link: string; bot_username: string; expires_in?: number };

const LINK_TTL_S = 600;

function TelegramConnect() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState<TgStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [linkData, setLinkData] = useState<LinkData | null>(null);
  const [issuedAt, setIssuedAt] = useState<number>(0);
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const loadStatus = useCallback(async (): Promise<TgStatus | null> => {
    if (!user?.traderName) return null;
    try {
      const r = await fetch(`${BASE}/api/telegram/status?trader=${encodeURIComponent(user.traderName)}`);
      if (!r.ok) throw new Error(String(r.status));
      const d = (await r.json()) as TgStatus;
      setStatus(d);
      setStatusError(false);
      return d;
    } catch {
      setStatusError(true);
      return null;
    }
  }, [user?.traderName]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const ttl = linkData?.expires_in ?? LINK_TTL_S;
  const secondsLeft = linkData ? Math.max(0, ttl - Math.floor((now - issuedAt) / 1000)) : 0;
  const expired = !!linkData && secondsLeft === 0;

  // While a link code is shown: tick the countdown and auto-detect the link every 5 s (read-only GET).
  useEffect(() => {
    if (!linkData || expired) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      if (document.hidden) return;
      const d = await loadStatus();
      if (d?.connected) {
        setLinkData(null);
        qc.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
        toast({ title: "Telegram подключён", description: "Бот будет присылать уведомления." });
      }
    }, 5000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [linkData, expired, loadStatus, qc, toast]);

  async function handleConnect() {
    setLoading(true);
    try {
      const r = await fetch(`${BASE}/api/telegram/link-token`, { method: "POST", headers: { "Content-Type": "application/json" } });
      if (!r.ok) throw new Error(await readApiError(r, "Не удалось получить код"));
      setLinkData((await r.json()) as LinkData);
      setIssuedAt(Date.now());
      setNow(Date.now());
    } catch (e) {
      toast({ title: "Ошибка", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const r = await fetch(`${BASE}/api/telegram/disconnect`, { method: "DELETE" });
      if (!r.ok) { toast({ title: "Не удалось отвязать Telegram", description: await readApiError(r), variant: "destructive" }); return; }
      setStatus({ connected: false, linked_at: null });
      setLinkData(null);
      qc.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
      toast({ title: "Telegram отвязан" });
    } catch {
      toast({ title: "Сетевая ошибка", variant: "destructive" });
    } finally {
      setDisconnecting(false);
      setConfirmDisconnect(false);
    }
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); toast({ title: "Скопировано" }); }
    catch { toast({ title: "Не удалось скопировать", variant: "destructive" }); }
  }

  const header = (
    <div className="flex items-center gap-3">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary"><Send className="h-5 w-5" aria-hidden="true" /></span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-semibold text-foreground">Telegram-бот</span>
          {status && <Pill tone={status.connected ? "up" : "neutral"} dot>{status.connected ? "Подключён" : "Не подключён"}</Pill>}
        </div>
        <p className="text-xs text-muted-foreground">Уведомления об идеях и ревью, ответы прямо из мессенджера</p>
      </div>
    </div>
  );

  if (!user?.traderName || user.role === "guest") {
    return <Panel>{header}<Callout className="mt-4">Войдите в аккаунт, чтобы подключить Telegram.</Callout></Panel>;
  }

  return (
    <Panel>
      <div className="flex flex-col gap-4">
        {header}
        {!status && statusError && <InlineError message="Не удалось загрузить статус Telegram" onRetry={() => loadStatus()} />}
        {!status && !statusError && <Skeleton className="h-16 rounded-xl" />}

        {status?.connected && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-up/10 px-3 py-3">
            <span className="flex items-center gap-2 text-sm text-foreground">
              <CheckCircle2 className="h-4 w-4 text-up" aria-hidden="true" />
              Привязан{status.linked_at ? ` с ${fmtDate(status.linked_at)}` : ""}. Пауза уведомлений — в разделе «Уведомления».
            </span>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDisconnect(true)} disabled={disconnecting} className="gap-1.5 text-down">
              <Unlink className="h-3.5 w-3.5" aria-hidden="true" /> Отвязать
            </Button>
          </div>
        )}

        {status && !status.connected && !linkData && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--glass-bg)] px-3 py-3">
            <span className="text-sm text-muted-foreground">Займёт 30 секунд: получите код, откройте бота и нажмите Start.</span>
            <Button size="sm" onClick={handleConnect} disabled={loading} className="gap-1.5">
              <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> {loading ? "Получаем код…" : "Подключить"}
            </Button>
          </div>
        )}

        {status && !status.connected && linkData && (
          <ol className="flex flex-col gap-3">
            <li className="flex items-start gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-solid text-xs font-semibold text-primary-foreground">1</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-foreground">Откройте бота</div>
                <Button asChild size="sm" variant="outline" className="mt-1.5 gap-1.5">
                  <a href={linkData.deep_link} target="_blank" rel="noopener noreferrer">@{linkData.bot_username} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a>
                </Button>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-solid text-xs font-semibold text-primary-foreground">2</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-foreground">Нажмите «Start» или отправьте команду</div>
                <div className="mt-1.5 flex items-center gap-2">
                  <code className="select-all rounded-full bg-[var(--glass-thick-bg)] px-3 py-1.5 text-sm font-semibold tracking-wider text-primary">/start {linkData.token}</code>
                  <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Скопировать команду" onClick={() => copy(`/start ${linkData.token}`)}><Copy aria-hidden="true" /></Button>
                </div>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--glass-thick-bg)] text-xs font-semibold text-muted-foreground">3</span>
              <div className="min-w-0 flex-1 text-sm" aria-live="polite">
                {expired ? (
                  <span className="text-down">Код истёк.</span>
                ) : (
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    Ждём подтверждения от бота… код действует ещё {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
                  </span>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={handleConnect} disabled={loading} className="gap-1.5">
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Новый код
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setLinkData(null)}>Отмена</Button>
                </div>
              </div>
            </li>
          </ol>
        )}
      </div>

      <AlertDialog open={confirmDisconnect} onOpenChange={(v) => { if (!disconnecting) setConfirmDisconnect(v); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отвязать Telegram?</AlertDialogTitle>
            <AlertDialogDescription>Уведомления перестанут приходить. Чтобы подключить снова, понадобится новый код.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction disabled={disconnecting} onClick={(e) => { e.preventDefault(); handleDisconnect(); }} className="bg-destructive text-destructive-foreground hover:brightness-110">
              {disconnecting ? "…" : "Отвязать"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}

const BROADCAST_TEMPLATES: { label: string; text: string }[] = [
  { label: "Премаркет", text: "<b>Премаркет</b>\nЗаполните game plan до открытия: in-play тикеры, катализаторы, уровни." },
  { label: "Ред-дэй стоп", text: "<b>Риск</b>\nНапоминание: при достижении дневного лимита убытка — стоп торговли на сегодня." },
  { label: "Разбор дня", text: "<b>Итоги дня</b>\nЗакройте журнал до конца дня: результаты, ошибки, скриншоты сетапов." },
];

function TelegramBroadcast() {
  const { can } = useAuth();
  const { toast } = useToast();
  const { data: team } = useTeam(can("users.read.team"));
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastResult, setLastResult] = useState<{ sent: number; failed: number; total: number } | null>(null);

  const recipients = team?.filter((m) => m.telegramLinked);
  const unbalanced = (() => {
    const open = (message.match(/<(b|i|code)>/g) ?? []).length;
    const close = (message.match(/<\/(b|i|code)>/g) ?? []).length;
    return open !== close;
  })();

  async function handleBroadcast() {
    if (!message.trim()) return;
    setSending(true);
    setLastResult(null);
    try {
      const r = await fetch(`${BASE}/api/telegram/broadcast`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: message.trim() }),
      });
      const d = (await r.json().catch(() => ({}))) as { ok?: boolean; sent?: number; failed?: number; total?: number; error?: string };
      if (r.ok && d.ok) {
        setLastResult({ sent: d.sent ?? 0, failed: d.failed ?? 0, total: d.total ?? 0 });
        toast({ title: `Отправлено: ${d.sent} из ${d.total}` });
        setMessage("");
      } else {
        toast({ title: d.error ?? `Ошибка рассылки (HTTP ${r.status})`, variant: "destructive" });
      }
    } catch {
      toast({ title: "Сетевая ошибка", variant: "destructive" });
    } finally {
      setSending(false);
      setConfirmOpen(false);
    }
  }

  return (
    <Panel title="Рассылка в Telegram" description="Ручное сообщение всем, кто привязал бота" icon={Radio}
      actions={recipients ? <Pill tone="accent">{recipients.length} получателей</Pill> : undefined}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          {BROADCAST_TEMPLATES.map((t) => (
            <button key={t.label} type="button" className="chip min-h-8 px-3 text-xs font-medium" onClick={() => setMessage(t.text)}>{t.label}</button>
          ))}
        </div>
        <Textarea value={message} onChange={(e) => setMessage(e.target.value)} aria-label="Текст рассылки" rows={5} maxLength={4000}
          placeholder="Текст сообщения. Поддерживается <b>жирный</b>, <i>курсив</i>, <code>код</code>" className="rounded-xl" />
        {message.trim() && (
          <div className="rounded-xl bg-[var(--glass-bg)] px-3 py-2.5">
            <div className="micro-label mb-1">Так увидят получатели</div>
            <TelegramPreview text={message} />
          </div>
        )}
        {unbalanced && <Callout tone="warn">Похоже, не закрыт HTML-тег — Telegram может отклонить сообщение.</Callout>}
        {recipients && recipients.length > 0 && (
          <p className="text-xs text-muted-foreground">Получат: {recipients.map((r) => r.name).join(", ")}</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {message.length}/4000
            {lastResult && <span className="ml-2 text-up">· доставлено {lastResult.sent}/{lastResult.total}{lastResult.failed > 0 && <span className="text-down"> · ошибок {lastResult.failed}</span>}</span>}
          </span>
          <Button size="sm" variant="secondary" onClick={() => setConfirmOpen(true)} disabled={sending || !message.trim() || recipients?.length === 0} className="gap-1.5">
            <Radio className="h-3.5 w-3.5" aria-hidden="true" /> {sending ? "Отправка…" : "Отправить всем"}
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={(v) => { if (!sending) setConfirmOpen(v); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отправить рассылку{recipients ? ` ${recipients.length} получателям` : ""}?</AlertDialogTitle>
            <AlertDialogDescription>Сообщение уйдёт всем пользователям с привязанным Telegram. Отозвать его будет нельзя.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction disabled={sending} onClick={(e) => { e.preventDefault(); handleBroadcast(); }}>{sending ? "Отправка…" : "Отправить"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}

/** Renders the Telegram-HTML subset (<b>, <i>, <code>) safely as React nodes. */
function TelegramPreview({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const re = /<(b|i|code)>([\s\S]*?)<\/\1>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const inner = m[2];
    parts.push(m[1] === "b" ? <strong key={k++}>{inner}</strong> : m[1] === "i" ? <em key={k++}>{inner}</em> : <code key={k++} className="rounded bg-[var(--glass-thick-bg)] px-1">{inner}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <p className="whitespace-pre-wrap text-sm text-foreground">{parts}</p>;
}

export function IntegrationsSection() {
  const { can } = useAuth();
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <TelegramConnect />
      {can("telegram.broadcast") ? <TelegramBroadcast /> : (
        <Callout icon={Send}>
          Через бота приходят уведомления о новых идеях, ревью куратора и комментариях. На уведомления об идеях можно отвечать прямо в Telegram.
        </Callout>
      )}
    </div>
  );
}
