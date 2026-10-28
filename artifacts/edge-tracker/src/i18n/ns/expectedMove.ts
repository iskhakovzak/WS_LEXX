import { createNamespace } from "..";
import ru from "../locales/ru/expectedMove";

/** Expected move on earnings (components/shared/expected-move/*). */
export const expectedMoveI18n = createNamespace("expectedMove", ru, {
  en: () => import("../locales/en/expectedMove"),
  uz: () => import("../locales/uz/expectedMove"),
});
