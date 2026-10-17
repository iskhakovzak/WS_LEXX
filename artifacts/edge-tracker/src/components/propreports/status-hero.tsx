/**
 * Connection status hero: configured (domain, auth mode, scheduler, last/next sync) or
 * "not configured" with the exact env var names for .env.local. Never shows or asks for secrets.
 */
import { Clock, KeyRound, Plug, PlugZap, Server } from "lucide-react";
import { Pill, StatCard, StatGrid } from "@/components/ds";
import { Kbd } from "@/components/ds";
import { agoText, untilText, type Status } from "./api";

export function StatusHero({ status, actions }: { status: Status; actions?: React.ReactNode }) {
  const { config, scheduler, accounts, trades, lastRun, connection } = status;
  const lastSync = trades.lastSyncedAt ?? accounts.lastSyncedAt ?? lastRun?.finishedAt ?? null;
  return (
    <section className="glass-panel rounded-2xl p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`glass-panel grid h-11 w-11 shrink-0 place-items-center rounded-xl ${config.configured ? "text-up" : "text-muted-foreground"}`}>
            {config.configured ? <PlugZap className="h-5 w-5" aria-hidden="true" /> : <Plug className="h-5 w-5" aria-hidden="true" />}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">PropReports</h2>
              {config.configured ? <Pill tone="up" dot>API настроено</Pill> : <Pill tone="warn" dot>API не настроено</Pill>}
              {config.configured && (connection.ok === true
                ? <Pill tone="accent">{connection.mode === "v2" ? "API v2 (токен)" : "legacy-логин"}{connection.version ? ` · v${connection.version}` : ""}</Pill>
                : connection.ok === false ? <Pill tone="down" dot>подключение: ошибка</Pill> : <Pill tone="neutral">подключение не проверено</Pill>)}
              {scheduler.enabled && <Pill tone="accent">авто-синк каждые {scheduler.minutes} мин</Pill>}
              {scheduler.running && <Pill tone="accent">синхронизация идёт…</Pill>}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {config.configured
                ? <>Хост <span className="font-mono text-foreground">{config.domain}</span> · авторизация {config.authMode === "token" ? "по токену (API v2)" : "по логину (API v1, токен обновляется каждые ~2 ч)"}{config.groupId ? <> · группа {config.groupId}</> : null}{config.accountIds.length ? <> · счета {config.accountIds.join(", ")}</> : null}</>
                : "Импорт файлов работает всегда. Для синхронизации по API добавьте переменные ниже в .env.local и перезапустите сервер."}
            </p>
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {!config.configured && (
        <div className="mt-4 rounded-xl border border-dashed border-[var(--glass-border)] p-3 text-sm">
          <div className="mb-2 flex items-center gap-2 text-muted-foreground"><KeyRound className="h-4 w-4" aria-hidden="true" /> Переменные окружения (только имена — значения в .env.local, в интерфейс их вводить не нужно):</div>
          <ul className="grid gap-1 font-mono text-xs sm:grid-cols-2">
            <li><Kbd>PROPREPORTS_DOMAIN</Kbd> <span className="font-sans text-muted-foreground">— поддомен фирмы (&lt;firm&gt;.propreports.com)</span></li>
            <li><Kbd>PROPREPORTS_TOKEN</Kbd> <span className="font-sans text-muted-foreground">— API-токен из Profile → API Tokens (v2)</span></li>
            <li><Kbd>PROPREPORTS_USER</Kbd> + <Kbd>PROPREPORTS_PASSWORD</Kbd> <span className="font-sans text-muted-foreground">— вместо токена (legacy v1)</span></li>
            <li><Kbd>PROPREPORTS_GROUP_ID</Kbd> / <Kbd>PROPREPORTS_ACCOUNT_IDS</Kbd> <span className="font-sans text-muted-foreground">— необязательно, область выборки</span></li>
            <li><Kbd>PROPREPORTS_SYNC_MINUTES</Kbd> <span className="font-sans text-muted-foreground">— необязательно, авто-синк (по умолчанию выключен)</span></li>
          </ul>
          {!!config.missing.length && <p className="mt-2 text-xs text-[hsl(var(--chart-3))]">Не хватает: {config.missing.join(", ")}</p>}
        </div>
      )}

      <StatGrid className="mt-4">
        <StatCard icon={Clock} label="Последняя синхронизация" value={lastSync ? agoText(lastSync) : "ещё не было"} hint={lastRun ? `${lastRun.source === "api" ? "API" : "файл"} · ${lastRun.status === "ok" ? "успешно" : lastRun.status === "partial" ? "частично" : lastRun.status === "error" ? "ошибка" : "идёт"}` : undefined} tone={lastRun?.status === "error" ? "down" : "neutral"} />
        <StatCard icon={Server} label="Следующий авто-синк" value={scheduler.enabled ? untilText(scheduler.nextRunAt) : "выключен"} hint={scheduler.enabled ? `каждые ${scheduler.minutes} мин` : "не настроен"} />
        <StatCard label="Счета" value={`${accounts.mapped} / ${accounts.total}`} hint={accounts.unmapped.length ? `без трейдера: ${accounts.unmapped.join(", ")}` : "все привязаны"} tone={accounts.unmapped.length ? "warn" : "neutral"} />
        <StatCard label="Сделок из брокера" value={Number(trades.imported).toLocaleString("ru-RU")} hint={trades.legacyWithoutId ? `${trades.legacyWithoutId} из старого импорта без ключа — привяжутся при следующем импорте` : status.pendingCount ? `${status.pendingCount} ждут сверки` : "всё синхронизировано"} tone={status.pendingCount ? "warn" : "neutral"} />
      </StatGrid>
    </section>
  );
}
