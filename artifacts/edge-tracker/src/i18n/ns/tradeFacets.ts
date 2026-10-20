import { createNamespace } from "..";
import ru from "../locales/ru/tradeFacets";

/** «Улучшенный поиск» (the «Фильтры» panel of /trades and /stats) and «Исключить IMX»: components/shared/trade-facets/*. */
export const tradeFacetsI18n = createNamespace("tradeFacets", ru, {
  en: () => import("../locales/en/tradeFacets"),
  uz: () => import("../locales/uz/tradeFacets"),
});
