import { createNamespace } from "..";
import ru from "../locales/ru/shellExtras";

/**
 * Shell texts owned by the admin/access area (shell.ts belongs to another area): the phone «Ещё» hint and the short
 * header countdown labels that stay visible at every width.
 */
export const shellExtrasI18n = createNamespace("shellExtras", ru, {
  en: () => import("../locales/en/shellExtras"),
  uz: () => import("../locales/uz/shellExtras"),
});
