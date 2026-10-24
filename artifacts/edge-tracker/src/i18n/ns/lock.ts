import { createNamespace } from "..";
import ru from "../locales/ru/lock";

/** Screen lock «Заблокировать» (components/lock/*, lib/lock/*). */
export const lockI18n = createNamespace("lock", ru, {
  en: () => import("../locales/en/lock"),
  uz: () => import("../locales/uz/lock"),
});
