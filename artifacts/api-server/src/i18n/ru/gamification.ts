/**
 * Server `gamification` (lib/gamification/*): recognition lines in the desk feed and the Telegram group, reward
 * notifications, mastery level names (the feed line only — the API sends level numbers). Names are data ({name} is the
 * reader's form of the name, or «Трейдер N» when names are hidden). Terms: edge-tracker/src/i18n/GLOSSARY.md.
 */
export default {
  alias: "Трейдер {n}",
  recognition: {
    achievement: "{name}: достижение «{achievement}» — {tier}",
    streak: {
      one: "{name}: контракт соблюдён {count} день подряд",
      few: "{name}: контракт соблюдён {count} дня подряд",
      many: "{name}: контракт соблюдён {count} дней подряд",
      other: "{name}: контракт соблюдён {count} дня подряд",
    },
    season_top: "{name}: {rank} место в сезоне «{season}»",
    mastery: "{name}: уровень «{level}» в сетапе {setup}",
    reward: "{name} получает награду «{title}»",
    subtitle: "Признание деска",
    telegram: "🏆 {text}",
  },
  masteryLevel: { l0: "Новичок", l1: "Ученик", l2: "Практик", l3: "Эксперт", l4: "Мастер" },
  taskDone: {
    title: "{trader}: задание куратора выполнено — подтвердите",
    body: "Задание: {note}",
    bodyNoNote: "Отметьте задание выполненным в кабинете куратора",
  },
  notify: {
    eligibleTitle: "Доступна награда «{title}»",
    eligibleBody: "Запроси её на вкладке «Квесты» — куратор вручит.",
    requestedTitle: "{trader} просит награду «{title}»",
    requestedBody: "Вручите или отклоните в очереди наград.",
    grantedTitle: "Награда «{title}» вручена",
    grantedBody: "Поздравляем — заслуженно.",
    grantedBodyNote: "Поздравляем! Комментарий: {note}",
    declinedTitle: "Запрос награды «{title}» отклонён",
    declinedBody: "Спроси куратора, что нужно для неё.",
    declinedBodyNote: "Комментарий: {note}",
  },
} as const;
