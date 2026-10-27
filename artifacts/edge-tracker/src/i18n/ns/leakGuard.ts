import { createNamespace } from "..";
import ru from "../locales/ru/leakGuard";

/** Live leak guard (components/leak-guard/*): the trader's banner, «Мой риск» impact, the risk desk panel. */
export const leakGuardI18n = createNamespace("leakGuard", ru, {
  en: () => import("../locales/en/leakGuard"),
  uz: () => import("../locales/uz/leakGuard"),
});
