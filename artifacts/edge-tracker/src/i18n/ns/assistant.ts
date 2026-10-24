import { createNamespace } from "..";
import ru from "../locales/ru/assistant";

/** «Ассистент WS» (components/assistant/*, components/shared/ask-assistant.tsx, components/shared/assist-help.tsx). */
export const assistantI18n = createNamespace("assistant", ru, {
  en: () => import("../locales/en/assistant"),
  uz: () => import("../locales/uz/assistant"),
});
