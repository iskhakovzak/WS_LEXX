import { createNamespace } from "..";
import ru from "../locales/ru/quotes";

/** Quote library UI: the dashboard card, the lock-screen quote and its Settings row (texts of quotes are data). */
export const quotesI18n = createNamespace("quotes", ru, {
  en: () => import("../locales/en/quotes"),
  uz: () => import("../locales/uz/quotes"),
});
