/**
 * Server `quests`: quest and achievement texts (lib/quests/*). Keys are the TextItems the API sends — the web `quests`
 * namespace has the same keys: `quest.<template>.title|desc` (params {target, count = target, done}),
 * `ach.<line>.title|hint` (params {target, count = target}), `tier.<tier>`. Used here for notifications and the
 * Telegram evening line. Terms: edge-tracker/src/i18n/GLOSSARY.md.
 */
export default {
  quest: {
    // onboarding
    set_pin: { title: "Задай свой PIN", desc: "Замени выданный пароль своим — так аккаунт только твой." },
    link_telegram: { title: "Подключи Telegram", desc: "Утренний фокус и вечерний итог дня будут приходить в бот." },
    first_plan_stop: { title: "Первый личный план с дневным стопом", desc: "Открой свой план на день и задай дневной стоп — это твой контракт." },
    first_review: { title: "Разбери первый итог дня", desc: "Открой итог дня на главной и отметь «Разобрал»." },
    open_desk_day: { title: "Открой «Деск на тикере»", desc: "Посмотри, как деск торговал твой тикер в тот же день." },
    replay_own_day: { title: "Переиграй свой день в симуляторе", desc: "Пройди заново свою сделку и сравни решения." },
    set_own_rule: { title: "Задай правило дня", desc: "Выбери в плане одно своё правило — например, ошибку из фокуса." },
    // daily
    plan_before_open: { title: "План до открытия", desc: "Составь личный план до 09:30 NY." },
    review_yesterday: { title: "Разбери прошедший день", desc: "Отметь итог дня «Разобрал» до конца следующего торгового дня." },
    keep_contract: { title: "Соблюди контракт сегодня", desc: "Дневной стоп, лимит сделок и своё правило — без нарушений." },
    tag_yesterday: { title: "Разметь сделки прошедшего дня", desc: "Укажи сетап из плейбука у сделок дня: {done} из {target}." },
    // weekly / curator
    contract_days: {
      title: { one: "Соблюди контракт {count} день", few: "Соблюди контракт {count} дня", many: "Соблюди контракт {count} дней", other: "Соблюди контракт {count} дня" },
      desc: "Дней с соблюдённым контрактом: {done} из {target}.",
    },
    focus_absent_days: {
      title: { one: "{count} день без ошибки из фокуса", few: "{count} дня без ошибки из фокуса", many: "{count} дней без ошибки из фокуса", other: "{count} дня без ошибки из фокуса" },
      desc: "Дней без ошибки из фокуса: {done} из {target}.",
    },
    replay_own_days: {
      title: { one: "Переиграй {count} свой день", few: "Переиграй {count} своих дня", many: "Переиграй {count} своих дней", other: "Переиграй {count} своих дня" },
      desc: "Своих дней переиграно в симуляторе: {done} из {target}.",
    },
    review_traded_days: { title: "Разбери каждый торговый день недели", desc: "Разобрано вовремя: {done} из {target}." },
    read_game_plan: {
      title: { one: "Прочитай план деска {count} раз", few: "Прочитай план деска {count} раза", many: "Прочитай план деска {count} раз", other: "Прочитай план деска {count} раза" },
      desc: "Планов деска прочитано: {done} из {target}.",
    },
    // monthly
    clean_month_progress: { title: "Чистый месяц", desc: "Дневной стоп ни разу не достигнут. Чистых торговых дней: {done} из {target}." },
    review_month: { title: "Разборы месяца", desc: "Торговых дней разобрано вовремя: {done} из {target} нужных." },
    // curator only
    review_days: {
      title: { one: "Разбери вовремя {count} торговый день", few: "Разбери вовремя {count} торговых дня", many: "Разбери вовремя {count} торговых дней", other: "Разбери вовремя {count} торгового дня" },
      desc: "Разобрано вовремя: {done} из {target}.",
    },
    plan_days: {
      title: { one: "План до открытия {count} день", few: "План до открытия {count} дня", many: "План до открытия {count} дней", other: "План до открытия {count} дня" },
      desc: "Дней с личным планом до 09:30 NY: {done} из {target}.",
    },
    beat_yourself: {
      title: { one: "Сыграй лучше себя {count} раз", few: "Сыграй лучше себя {count} раза", many: "Сыграй лучше себя {count} раз", other: "Сыграй лучше себя {count} раза" },
      desc: "В симуляторе лучше реальной сделки: {done} из {target}.",
    },
    curator_task: { title: "Задание куратора", desc: "Куратор отметит, когда задание выполнено." },
  },
  ach: {
    contract_streak: {
      title: "Серия контракта",
      hint: { one: "Соблюдай свой контракт {count} день подряд", few: "Соблюдай свой контракт {count} дня подряд", many: "Соблюдай свой контракт {count} дней подряд", other: "Соблюдай свой контракт {count} дня подряд" },
    },
    clean_month: {
      title: "Чистый месяц",
      hint: { one: "{count} месяц без достижения дневного стопа", few: "{count} месяца без достижения дневного стопа", many: "{count} месяцев без достижения дневного стопа", other: "{count} месяца без достижения дневного стопа" },
    },
    comeback: {
      title: "Возвращение",
      hint: { one: "Соблюди контракт на следующий день после нарушения — {count} раз", few: "Соблюди контракт на следующий день после нарушения — {count} раза", many: "Соблюди контракт на следующий день после нарушения — {count} раз", other: "Соблюди контракт на следующий день после нарушения — {count} раза" },
    },
    reviews_total: {
      title: "Разбор дня",
      hint: { one: "Разбери {count} торговый день", few: "Разбери {count} торговых дня", many: "Разбери {count} торговых дней", other: "Разбери {count} торгового дня" },
    },
    review_streak: {
      title: "Разбор без пропусков",
      hint: { one: "Разбирай каждый торговый день вовремя — {count} день подряд", few: "Разбирай каждый торговый день вовремя — {count} дня подряд", many: "Разбирай каждый торговый день вовремя — {count} дней подряд", other: "Разбирай каждый торговый день вовремя — {count} дня подряд" },
    },
    focus_beaten: {
      title: "Победил ошибку",
      hint: { one: "Ошибки из фокуса нет {count} день подряд", few: "Ошибки из фокуса нет {count} дня подряд", many: "Ошибки из фокуса нет {count} дней подряд", other: "Ошибки из фокуса нет {count} дня подряд" },
    },
    plan_before_open: {
      title: "План до открытия",
      hint: { one: "Личный план до 09:30 NY — {count} день", few: "Личный план до 09:30 NY — {count} дня", many: "Личный план до 09:30 NY — {count} дней", other: "Личный план до 09:30 NY — {count} дня" },
    },
    full_loop: {
      title: "Полный круг",
      hint: { one: "План до открытия, соблюдённый контракт и разбор в тот же день — {count} день", few: "План до открытия, соблюдённый контракт и разбор в тот же день — {count} дня", many: "План до открытия, соблюдённый контракт и разбор в тот же день — {count} дней", other: "План до открытия, соблюдённый контракт и разбор в тот же день — {count} дня" },
    },
    own_replays: {
      title: "Переиграй свой день",
      hint: { one: "Переиграй свой день в симуляторе — {count} раз", few: "Переиграй свой день в симуляторе — {count} раза", many: "Переиграй свой день в симуляторе — {count} раз", other: "Переиграй свой день в симуляторе — {count} раза" },
    },
    beat_yourself: {
      title: "Лучше себя",
      hint: { one: "Сыграй в симуляторе лучше реальной сделки — {count} раз", few: "Сыграй в симуляторе лучше реальной сделки — {count} раза", many: "Сыграй в симуляторе лучше реальной сделки — {count} раз", other: "Сыграй в симуляторе лучше реальной сделки — {count} раза" },
    },
    lessons: {
      title: "Ученик",
      hint: { one: "Пройди {count} урок Академии", few: "Пройди {count} урока Академии", many: "Пройди {count} уроков Академии", other: "Пройди {count} урока Академии" },
    },
    exams: {
      title: "Экзамен сдан",
      hint: { one: "Сдай {count} экзамен Академии", few: "Сдай {count} экзамена Академии", many: "Сдай {count} экзаменов Академии", other: "Сдай {count} экзамена Академии" },
    },
    tier_up: { title: "Рост по ступеням", hint: "Повышение по лестнице: Джун → Трейдер → Сеньор" },
    onboarding: { title: "Первые шаги", hint: "Выполни все задания первых шагов" },
    secret: { title: "Секретное достижение", hint: "Откроется, когда заслужишь" },
  },
  /** Notifications (lib/notificationRenderers/quests.ts); {quest} / {achievement} / {tier} come from the keys above. */
  notify: {
    doneTitle: "Квест выполнен: {quest}",
    doneBody: "+{points} к дисциплине. Все квесты — во вкладке «Квесты и достижения».",
    doneBodyNoPoints: "Все квесты — во вкладке «Квесты и достижения».",
    staffDoneTitle: "{trader}: квест выполнен — {quest}",
    staffFailedTitle: "{trader}: квест не выполнен — {quest}",
    staffBody: { failed: "Условие нарушено — стоит обсудить на разборе.", expired: "Срок истёк, цель не достигнута.", done: "Задание выполнено." },
    assignedTitle: "Задание от куратора: {quest}",
    assignedBody: "{curator} · до {ends} · +{points} к дисциплине",
    assignedBodyNote: "{curator} · до {ends} · +{points} к дисциплине\n«{note}»",
    cancelledTitle: "Квест отменён: {quest}",
    cancelledBody: "{curator} отменил(а) задание — выполнять его больше не нужно.",
    achievementTitle: "Достижение: {achievement} — {tier}",
    achievementBody: "Новая ступень достижения. Все достижения — во вкладке «Квесты и достижения».",
  },
  tier: { bronze: "бронза", silver: "серебро", gold: "золото", platinum: "платина" },
} as const;
