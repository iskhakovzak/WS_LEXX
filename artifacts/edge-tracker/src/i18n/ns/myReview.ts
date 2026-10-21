import { createNamespace } from "..";
import ru from "../locales/ru/myReview";

/** «Мой разбор» (Волна 2 п. 2.9): pages/my-review.tsx, components/my-review/*. */
export const myReviewI18n = createNamespace("myReview", ru, {
  en: () => import("../locales/en/myReview"),
  uz: () => import("../locales/uz/myReview"),
});
