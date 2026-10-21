/**
 * The one mistakes vocabulary (Волна 2, item 2.8) — the same list as the server (api-server lib/tradingErrors.ts
 * ERROR_VOCAB): a code, the canonical stored word, the default severity and the older spellings (key M and the journal
 * used to store «FOMO», «Реванш»…, «Ошибки» stored «FOMO / погоня», «Отыгрыш после убытка»…). Every screen shows a
 * mistake by its code in the UI language (rules namespace `mistakeCat.*`); stored words stay data.
 */
import { rulesI18n } from "@/i18n/ns/rules";

export const ERROR_CODES = [
  "fomo", "offPlan", "earlyEntry", "movedStop", "noStop", "averagingDown", "oversize", "overtrading",
  "revenge", "earlyExit", "heldLoser", "ignoredNews", "lateExit", "offSetup",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export type ErrorSeverity = "low" | "medium" | "high" | "critical";

type Entry = { code: ErrorCode; canonical: string; severity: ErrorSeverity; aliases: readonly string[] };

export const ERROR_VOCAB: readonly Entry[] = [
  { code: "fomo", canonical: "FOMO / погоня", severity: "medium", aliases: ["FOMO"] }, // i18n-ignore (stored word)
  { code: "offPlan", canonical: "Вход не по плану", severity: "high", aliases: ["Без плана"] }, // i18n-ignore
  { code: "earlyEntry", canonical: "Ранний вход", severity: "medium", aliases: [] }, // i18n-ignore
  { code: "movedStop", canonical: "Сдвинул стоп", severity: "high", aliases: ["Двигал стоп"] }, // i18n-ignore
  { code: "noStop", canonical: "Без стопа", severity: "critical", aliases: [] }, // i18n-ignore
  { code: "averagingDown", canonical: "Усреднение убытка", severity: "critical", aliases: [] }, // i18n-ignore
  { code: "oversize", canonical: "Завышенный размер", severity: "high", aliases: ["Большой размер"] }, // i18n-ignore
  { code: "overtrading", canonical: "Переторговка", severity: "medium", aliases: ["Овертрейдинг"] }, // i18n-ignore
  { code: "revenge", canonical: "Отыгрыш после убытка", severity: "high", aliases: ["Реванш"] }, // i18n-ignore
  { code: "earlyExit", canonical: "Ранний выход из прибыли", severity: "low", aliases: ["Ранний выход"] }, // i18n-ignore
  { code: "heldLoser", canonical: "Пересидел убыток", severity: "high", aliases: [] }, // i18n-ignore
  { code: "ignoredNews", canonical: "Проигнорировал новости", severity: "medium", aliases: [] }, // i18n-ignore
  { code: "lateExit", canonical: "Поздний выход", severity: "medium", aliases: [] }, // i18n-ignore
  { code: "offSetup", canonical: "Не по сетапу", severity: "medium", aliases: [] }, // i18n-ignore
];

const BY_CODE = new Map(ERROR_VOCAB.map((e) => [e.code, e]));
const BY_WORD = new Map<string, Entry>();
for (const e of ERROR_VOCAB) for (const w of [e.canonical, ...e.aliases]) BY_WORD.set(w.trim().toLowerCase(), e);

/** Code of a stored word (any spelling, case-insensitive); null = not a vocabulary mistake. */
export function errorCodeOf(word: string | null | undefined): ErrorCode | null {
  return typeof word === "string" ? BY_WORD.get(word.trim().toLowerCase())?.code ?? null : null;
}

export function isErrorCode(v: unknown): v is ErrorCode {
  return typeof v === "string" && BY_CODE.has(v as ErrorCode);
}

/** The word stored for a code (trades.tags, the journal review, trading_errors.error_type). */
export function canonicalOf(code: ErrorCode): string {
  return BY_CODE.get(code)!.canonical;
}

export function severityOf(code: ErrorCode): ErrorSeverity {
  return BY_CODE.get(code)!.severity;
}

/** «FOMO / погоня» in the UI language. */
export function errorLabel(code: ErrorCode): string {
  return rulesI18n.t(`mistakeCat.${code}.label`);
}

export function errorHint(code: ErrorCode): string {
  return rulesI18n.t(`mistakeCat.${code}.hint`);
}

/** A stored word as shown: a vocabulary mistake in the UI language, anything else as typed (null when not a mistake). */
export function errorWordLabel(word: string): string | null {
  const c = errorCodeOf(word);
  return c ? errorLabel(c) : null;
}

/** Vocabulary codes among stored words (order of first appearance). */
export function codesOfWords(words: Iterable<string>): ErrorCode[] {
  const out: ErrorCode[] = [];
  for (const w of words) {
    const c = errorCodeOf(w);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/** Words with the code switched on (canonical word added unless a spelling is there) or off (every spelling removed). */
export function withErrorCode(words: readonly string[], code: ErrorCode, on: boolean): string[] {
  const has = words.some((w) => errorCodeOf(w) === code);
  if (on) return has ? [...words] : [...words, canonicalOf(code)];
  return words.filter((w) => errorCodeOf(w) !== code);
}
