/**
 * Coaching evidence, roadmap Wave 1: the intervention log (R9a), the edge map (R4), the plateau section for curators
 * (R6) and the curator priority (R11). Task framing only: a junior never reads «застрял» — plateau texts are staff-only.
 */
export default {
  interventions: {
    title: "Вмешательства",
    description: "Что деск делал для трейдера. Эффект появится, когда наберётся 40 дней после действия.",
    empty: "Пока ничего не записано: лимиты, правила, фокус, 1:1, квесты и тревоги записываются сами.",
    effectPending: "эффект: нет данных",
    by: "{who} · {date}",
    showAll: "Показать все ({count})",
    kind: {
      limit_change: "Лимиты изменены",
      size_change: "Размер изменён",
      rule_added: "Правило включено",
      rule_removed: "Правило снято",
      rule_trial: "Испытание правила",
      focus_set: "Фокус дня от куратора",
      one_on_one: "Встреча 1:1",
      pause: "Пауза",
      quest: "Квест от куратора",
      fee_plan: "Тариф комиссий",
      concern_note: "Тревожная заметка",
      plateau_review: "Разбор: темп ниже нужного",
      scaling_decision: "Решение по тиру",
    },
    trigger: {
      scheduled: "по плану",
      after_bad_period: "после слабого периода",
      plateau: "темп ниже нужного",
      breach: "после нарушения",
      random: "случайный выбор",
      trader_request: "по просьбе трейдера",
    },
    system: "система",
  },
} as const;
