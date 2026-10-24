import { createNamespace } from "..";
import ru from "../locales/ru/onboarding";

/** First visit: guided tour, «Первые шаги», page hints, «Помощь» (lib/onboarding, components/onboarding, components/shared/page-hint). */
export const onboardingI18n = createNamespace("onboarding", ru, {
  en: () => import("../locales/en/onboarding"),
  uz: () => import("../locales/uz/onboarding"),
});
