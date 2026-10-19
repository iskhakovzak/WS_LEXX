/**
 * Shell extras (components/shell/mobile-more-sheet.tsx, market-clock.tsx): the phone «Ещё» hint (ILYA-18) and the short
 * countdown label in the header (DENIS-34).
 */
export default {
  mobile: {
    moreHint: {
      junior: "Остальные разделы. В основное меню они встанут с уровня Джун.",
      trader: "Остальные разделы. В основное меню они встанут с уровня Трейдер.",
    },
  },
  clock: {
    nextShort: { toOpen: "открытие", toClose: "закрытие", toAfterEnd: "конец", toPremarket: "премаркет" },
  },
} as const;
