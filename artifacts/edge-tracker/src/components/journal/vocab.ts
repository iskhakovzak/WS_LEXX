/** Day-scale labels moved to components/shared/day-labels (journal and EOD both use them). */
export { MOOD_LABELS, DISCIPLINE_LABELS } from "@/components/shared/day-labels";

// Stored tag codes: the day's tags keep the Russian word; `tagLabel` shows it in the UI language.
/** Rule-violation tags (stored in the day's tags; same taxonomy as the per-trade review). */
export const MISTAKE_TAGS = ["FOMO", "Ранний вход", "Поздний выход", "Двигал стоп", "Овертрейдинг", "Реванш", "Без плана", "Большой размер"]; // i18n-ignore (stored codes)
/** Legacy positive tags — still shown when present, no longer offered as chips. */
export const GOOD_TAGS = ["По плану", "Терпение", "Чистый выход", "Резал убыток"]; // i18n-ignore (stored codes)
/** Emotions of the day (stored in the day's tags). */
export const EMOTION_TAGS = ["Спокойствие", "Уверенность", "Азарт", "Нетерпение", "Страх", "Жадность", "Скука", "Раздражение"]; // i18n-ignore (stored codes)
export const CALM_EMOTIONS = new Set(["Спокойствие", "Уверенность"]); // i18n-ignore (stored codes)

export const sameTag = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
