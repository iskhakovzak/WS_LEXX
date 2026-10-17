/**
 * One place that turns whatever the API (or fetch) threw into a Russian sentence for a toast.
 *
 *   humanizeApiError(err)                → "Сначала заполните пре-трейд чек-лист"
 *   humanizeApiError(err, "Не удалось")  → fallback when nothing better is known
 *   apiErrorStatus(err) / apiErrorCode(err) → for branching (e.g. open the checklist dialog on CHECKLIST_REQUIRED)
 *
 * Accepts: ApiError from the generated client ({status, data:{error,code}}), a plain Error whose
 * message is "HTTP 403 Forbidden: Only curators…" or a raw JSON string, a Response, a string, or
 * an API body object. Unknown English messages fall back to a per-status default.
 */

export type ApiErrorInfo = {
  status: number | null;
  code: string | null;
  /** Raw server message (may be English). */
  raw: string | null;
  /** Russian text for people. */
  message: string;
  isNetwork: boolean;
};

const CODE_RU: Record<string, string> = {
  AUTH_REQUIRED: "Нужно войти в систему",
  GUEST_READ_ONLY: "Гостевой режим: только просмотр",
  INVALID_CREDENTIALS: "Неверное имя или пароль",
  BANNED: "Доступ заблокирован. Обратитесь к куратору",
  FORBIDDEN: "Недостаточно прав для этого действия",
  VALIDATION: "Проверьте заполненные поля",
  RATE_LIMITED: "Слишком много запросов — подождите немного",
  INTERNAL: "Ошибка сервера. Попробуйте ещё раз",
  CHECKLIST_REQUIRED: "Сначала заполните пре-трейд чек-лист",
  CHECKLIST_NOT_PASSED: "Чек-лист не пройден: обязательные пункты не выполнены",
  CHECKLIST_MISMATCH: "Чек-лист заполнен для другого тикера или даты",
  CHECKLIST_INVALID_ID: "Чек-лист не найден — заполните его заново",
  CHECKLIST_ALREADY_LINKED: "Этот чек-лист уже привязан к другой сделке",
  IDEA_ALREADY_CONVERTED: "Идея уже превращена в сделку",
  FOLDER_EXISTS: "Папка с таким названием уже есть",
  NOT_FOUND: "Не найдено — возможно, уже удалено",
  // API: 503 { code: "ai_not_configured" } when AI_INTEGRATIONS_ANTHROPIC_* env is missing (audit P2-3)
  ai_not_configured: "AI не настроен",
};

/** English server messages (exact or prefix, case-insensitive) → Russian. Longest match wins. */
const MESSAGE_RU: Array<[string, string]> = [
  ["pre-trade checklist required", CODE_RU.CHECKLIST_REQUIRED],
  ["checklist required", CODE_RU.CHECKLIST_REQUIRED],
  ["only curators and admins can review ideas", "Проверять идеи могут только кураторы"],
  ["only curators can leave reviews", "Оставлять разбор могут только кураторы"],
  ["only curators can rate", "Ставить оценки могут только кураторы"],
  ["only curators", "Только для кураторов"],
  ["curator or admin role required", "Только для кураторов"],
  ["admin password required", "Нужен пароль администратора"],
  ["authentication required", CODE_RU.AUTH_REQUIRED],
  ["not authenticated", CODE_RU.AUTH_REQUIRED],
  ["invalid credentials", CODE_RU.INVALID_CREDENTIALS],
  ["user is banned", CODE_RU.BANNED],
  ["not authorized", CODE_RU.FORBIDDEN],
  ["forbidden", CODE_RU.FORBIDDEN],
  ["not your trade", "Это не ваша сделка"],
  ["not found", CODE_RU.NOT_FOUND],
  ["invalid request", CODE_RU.VALIDATION],
  ["invalid id", "Некорректный идентификатор"],
  ["validation", CODE_RU.VALIDATION],
  ["too many requests", CODE_RU.RATE_LIMITED],
  ["rate limit", CODE_RU.RATE_LIMITED],
  ["internal server error", CODE_RU.INTERNAL],
  ["did you forget to provision the anthropic ai integration", CODE_RU.ai_not_configured],
  ["ai_integrations_anthropic", CODE_RU.ai_not_configured],
  ["failed to fetch", "Сервер недоступен — проверьте соединение"],
  ["networkerror", "Сервер недоступен — проверьте соединение"],
  ["load failed", "Сервер недоступен — проверьте соединение"],
  ["unexpected token", "Сервер вернул некорректный ответ"],
  ["failed to parse response", "Сервер вернул некорректный ответ"],
];

const STATUS_RU: Record<number, string> = {
  400: "Некорректный запрос — проверьте данные",
  401: "Нужно войти в систему",
  403: "Недостаточно прав для этого действия",
  404: "Не найдено — возможно, уже удалено",
  409: "Конфликт: такая запись уже существует",
  413: "Слишком большой запрос (файл или текст)",
  422: "Данные не прошли проверку",
  429: "Слишком много запросов — подождите немного",
  500: "Ошибка сервера. Попробуйте ещё раз",
  502: "Сервер временно недоступен",
  503: "Сервис временно недоступен",
  504: "Сервер не ответил вовремя",
};

const CYRILLIC = /[Ѐ-ӿ]/;

function pickString(o: unknown, keys: string[]): string | null {
  if (!o || typeof o !== "object") return null;
  for (const k of keys) {
    const v = (o as Record<string, unknown>)[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function parseJsonMaybe(s: string): unknown {
  const t = s.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return null;
  try { return JSON.parse(t); } catch { return null; }
}

/** "HTTP 403 Forbidden: Only curators…" → { status: 403, rest: "Only curators…" } */
function parseHttpPrefix(msg: string): { status: number | null; rest: string } {
  const m = /^HTTP\s+(\d{3})(?:\s+[^:]*)?(?::\s*([\s\S]*))?$/.exec(msg.trim());
  if (!m) return { status: null, rest: msg };
  return { status: Number(m[1]), rest: (m[2] ?? "").trim() };
}

function translateMessage(raw: string | null): string | null {
  if (!raw) return null;
  if (CYRILLIC.test(raw)) return raw; // already Russian — pass through
  const lower = raw.toLowerCase();
  let best: string | null = null;
  let bestLen = 0;
  for (const [needle, ru] of MESSAGE_RU) {
    if (lower.includes(needle) && needle.length > bestLen) { best = ru; bestLen = needle.length; }
  }
  return best;
}

type ParseState = { status: number | null; code: string | null; raw: string | null; isNetwork: boolean };

function fromBody(s: ParseState, body: unknown): void {
  if (!body) return;
  if (typeof body === "string") {
    const parsed = parseJsonMaybe(body);
    if (parsed) { fromBody(s, parsed); return; }
    if (s.raw == null) s.raw = body.trim() || null;
    return;
  }
  if (typeof body === "object") {
    if (s.code == null) s.code = pickString(body, ["code"]);
    if (s.raw == null) s.raw = pickString(body, ["error", "message", "detail", "title", "error_description"]);
    const st = (body as { status?: unknown }).status;
    if (s.status == null && typeof st === "number") s.status = st;
  }
}

export function describeApiError(err: unknown): ApiErrorInfo {
  const s: ParseState = { status: null, code: null, raw: null, isNetwork: false };

  if (err instanceof Response) {
    s.status = err.status;
  } else if (typeof err === "string") {
    const p = parseHttpPrefix(err);
    if (p.status) { s.status = p.status; fromBody(s, p.rest); }
    else fromBody(s, err);
  } else if (err && typeof err === "object") {
    const e = err as { status?: unknown; statusCode?: unknown; data?: unknown; response?: unknown; body?: unknown; message?: unknown; name?: unknown; code?: unknown };
    if (typeof e.status === "number") s.status = e.status;
    else if (typeof e.statusCode === "number") s.status = e.statusCode;
    if (typeof e.code === "string") s.code = e.code;
    fromBody(s, e.data);
    fromBody(s, e.body);
    if (e.response instanceof Response && s.status == null) s.status = e.response.status;
    if (typeof e.message === "string" && e.message.trim()) {
      const p = parseHttpPrefix(e.message);
      if (p.status && s.status == null) s.status = p.status;
      if (s.raw == null) fromBody(s, p.rest || e.message);
      if (e.name === "TypeError" || /failed to fetch|networkerror|load failed/i.test(e.message)) s.isNetwork = true;
    }
  }

  if (s.raw && /^Request failed with status/i.test(s.raw)) s.raw = null;
  const { status, code, raw, isNetwork } = s;

  const message =
    (code && CODE_RU[code]) ||
    translateMessage(raw) ||
    (status != null && STATUS_RU[status]) ||
    (isNetwork ? "Сервер недоступен — проверьте соединение" : null) ||
    (status != null && status >= 500 ? STATUS_RU[500] : null) ||
    (raw && raw.length <= 200 ? raw : null) ||
    "Что-то пошло не так. Попробуйте ещё раз";

  return { status, code, raw, message, isNetwork };
}

/** Russian, toast-ready text for any error. */
export function humanizeApiError(err: unknown, fallback?: string): string {
  const info = describeApiError(err);
  if (fallback && info.message === "Что-то пошло не так. Попробуйте ещё раз") return fallback;
  return info.message;
}

export function apiErrorStatus(err: unknown): number | null {
  return describeApiError(err).status;
}

export function apiErrorCode(err: unknown): string | null {
  return describeApiError(err).code;
}

/** True when the server answered 503 { code: "ai_not_configured" } — show «AI не настроен», disable AI buttons, don't retry. */
export function isAiNotConfiguredError(err: unknown): boolean {
  const info = describeApiError(err);
  return info.code === "ai_not_configured" || info.message === CODE_RU.ai_not_configured;
}

export function isAuthError(err: unknown): boolean {
  return apiErrorStatus(err) === 401;
}

/** 4xx errors should not be retried by react-query. */
export function isClientError(err: unknown): boolean {
  const s = apiErrorStatus(err);
  return s != null && s >= 400 && s < 500;
}
