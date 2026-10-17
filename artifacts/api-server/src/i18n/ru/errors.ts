/**
 * Server `errors`: the text of every API error code (key = code from src/lib/http/errors.ts ERROR_CODES).
 * RU is the source; EN/UZ must have the same keys. Add a code here AND in ERROR_CODES (tsc checks both ways),
 * then list it in src/lib/http/CODES.md. Terms: edge-tracker/src/i18n/GLOSSARY.md.
 */
export default {
  // 400
  BAD_REQUEST: "Некорректный запрос",
  VALIDATION: "Проверьте заполненные поля",
  INVALID_JSON: "Некорректный JSON в теле запроса",
  INVALID_ID: "Некорректный идентификатор",
  INVALID_DATE: "Некорректная дата, нужен формат ГГГГ-ММ-ДД",
  INVALID_TICKER: "Некорректный тикер",
  TICKER_REQUIRED: "Укажите тикер",
  INVALID_TRADER: "Некорректное имя трейдера",
  TRADER_REQUIRED: "Укажите трейдера",
  NO_FIELDS: "Нечего обновлять",
  UPLOAD_ERROR: "Не удалось принять файл",
  // 401
  AUTH_REQUIRED: "Требуется вход",
  // 403
  FORBIDDEN: "Недостаточно прав для этого действия",
  GUEST_READ_ONLY: "Гостевой режим: только просмотр",
  STAFF_ONLY: "Только для кураторов и администраторов",
  TRADE_FORBIDDEN: "Нет доступа к сделке",
  CORS_REJECTED: "Запросы с этого адреса не разрешены",
  // 404
  NOT_FOUND: "Не найдено",
  TRADE_NOT_FOUND: "Сделка не найдена",
  TRADER_NOT_FOUND: "Трейдер не найден",
  USER_NOT_FOUND: "Пользователь не найден",
  RESEARCH_NOT_FOUND: "Исследование не найдено",
  EVENT_NOT_FOUND: "Событие не найдено",
  FEED_ENTRY_NOT_FOUND: "Запись ленты не найдена",
  DISCUSSION_NOT_FOUND: "Обсуждение не найдено",
  COMMENT_NOT_FOUND: "Комментарий не найден",
  IDEA_NOT_FOUND: "Идея не найдена",
  COHORT_NOT_FOUND: "Когорта не найдена",
  SESSION_NOT_FOUND: "Занятие не найдено",
  CHECKLIST_ITEM_NOT_FOUND: "Пункт чек-листа не найден",
  // 409
  CONFLICT: "Конфликт с существующими данными",
  // 413
  TOO_LARGE: "Слишком большой запрос (файл или текст)",
  // 429
  RATE_LIMITED: "Слишком много запросов, попробуйте позже",
  // 5xx
  INTERNAL: "Внутренняя ошибка сервера",
  AI_UNAVAILABLE: "AI недоступен, попробуйте позже",
  TIMEOUT: "Сервер не успел ответить, попробуйте ещё раз",
} as const;
