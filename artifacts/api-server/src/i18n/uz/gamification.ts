import type { Messages } from "../core";
import type ru from "../ru/gamification";

export default {
  alias: "Treyder {n}",
  recognition: {
    achievement: "{name}: «{achievement}» yutugʻi — {tier}",
    streak: { one: "{name}: kontraktga ketma-ket {count} kun rioya qilindi", other: "{name}: kontraktga ketma-ket {count} kun rioya qilindi" },
    season_top: "{name}: «{season}» mavsumida {rank}-oʻrin",
    mastery: "{name}: {setup} setapida «{level}» darajasi",
    reward: "{name} «{title}» mukofotini oladi",
    subtitle: "Desk eʼtirofi",
    telegram: "🏆 {text}",
  },
  masteryLevel: { l0: "Yangi boshlovchi", l1: "Shogird", l2: "Amaliyotchi", l3: "Ekspert", l4: "Usta" },
  notify: {
    eligibleTitle: "«{title}» mukofoti mavjud",
    eligibleBody: "Uni «Kvestlar» boʻlimida soʻrang — kurator topshiradi.",
    requestedTitle: "{trader} «{title}» mukofotini soʻramoqda",
    requestedBody: "Mukofotlar navbatida topshiring yoki rad eting.",
    grantedTitle: "«{title}» mukofoti topshirildi",
    grantedBody: "Tabriklaymiz — munosib.",
    grantedBodyNote: "Tabriklaymiz! Izoh: {note}",
    declinedTitle: "«{title}» mukofoti soʻrovi rad etildi",
    declinedBody: "Buning uchun nima kerakligini kuratordan soʻrang.",
    declinedBodyNote: "Izoh: {note}",
  },
} satisfies Messages<typeof ru>;
