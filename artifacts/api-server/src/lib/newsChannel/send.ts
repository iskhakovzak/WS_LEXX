/**
 * WS_NEWS channel — one Telegram Bot API sendMessage (parse_mode HTML) with retries: 429 (waits Telegram's
 * retry_after, ≤ 60 s) and 5xx / network errors (1 s, 2 s, 4 s … ≤ 30 s), at most MAX_ATTEMPTS calls. Any other
 * answer (400 bad HTML, 403 bot not in the channel) is final. The bot token is only ever part of the request URL:
 * it is never logged and never returned (errors are logged by status / Telegram's description / error name).
 */
import { logger } from "../logger";

export const MAX_ATTEMPTS = 4;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_RETRY_AFTER_S = 60;
const MAX_BACKOFF_MS = 30_000;

export type SendResult =
  | { ok: true; messageId: number | null; attempts: number }
  | { ok: false; status: number | null; description: string | null; attempts: number };

export type SendDeps = {
  fetch: typeof fetch;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });

const LIVE: SendDeps = { fetch: (...a) => fetch(...a), sleep };

type TgAnswer = { ok?: boolean; description?: string; result?: { message_id?: number }; parameters?: { retry_after?: number } };

/** Wait before attempt n+1 (n ≥ 1): Telegram's retry_after on 429, else exponential. */
export function retryDelayMs(attempt: number, retryAfterS: number | null | undefined): number {
  if (typeof retryAfterS === "number" && retryAfterS > 0) return Math.min(retryAfterS, MAX_RETRY_AFTER_S) * 1000;
  return Math.min(1000 * 2 ** (attempt - 1), MAX_BACKOFF_MS);
}

const retryable = (status: number | null) => status == null || status === 429 || status >= 500;

export async function sendChannelMessage(
  o: { token: string; chatId: string; text: string; signal?: AbortSignal },
  deps: SendDeps = LIVE,
): Promise<SendResult> {
  let last: { status: number | null; description: string | null } = { status: null, description: null };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (o.signal?.aborted) return { ok: false, ...last, attempts: attempt - 1 };
    let retryAfter: number | null = null;
    try {
      const res = await deps.fetch(`https://api.telegram.org/bot${o.token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: o.chatId, text: o.text, parse_mode: "HTML", disable_web_page_preview: true }),
        signal: o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]) : AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const body = (await res.json().catch(() => ({}))) as TgAnswer;
      if (res.ok && body.ok) return { ok: true, messageId: body.result?.message_id ?? null, attempts: attempt };
      last = { status: res.status, description: typeof body.description === "string" ? body.description.slice(0, 300) : null };
      retryAfter = body.parameters?.retry_after ?? null;
    } catch (err) {
      last = { status: null, description: err instanceof Error ? err.name : "error" };
    }
    logger.warn({ attempt, status: last.status, description: last.description }, "news-channel: Telegram send failed");
    if (!retryable(last.status) || attempt === MAX_ATTEMPTS) return { ok: false, ...last, attempts: attempt };
    await deps.sleep(retryDelayMs(attempt, retryAfter), o.signal);
  }
  return { ok: false, ...last, attempts: MAX_ATTEMPTS };
}
