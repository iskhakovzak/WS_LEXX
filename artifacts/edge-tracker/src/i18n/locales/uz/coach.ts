import type { Messages } from "../../core";
import type ru from "../ru/coach";

export default {
  interventions: {
    title: "Aralashuvlar",
    description: "Desk treyder uchun nima qilgani. Natija harakatdan keyin 40 kun oʻtgach koʻrinadi.",
    empty: "Hozircha hech narsa yozilmagan: limitlar, qoidalar, fokus, 1:1, kvestlar va xavotirlar oʻzi yoziladi.",
    effectPending: "natija: maʼlumot yoʻq",
    by: "{who} · {date}",
    showAll: "Hammasini koʻrsatish ({count})",
    kind: {
      limit_change: "Limitlar oʻzgardi",
      size_change: "Hajm oʻzgardi",
      rule_added: "Qoida yoqildi",
      rule_removed: "Qoida olib tashlandi",
      rule_trial: "Qoida sinovi",
      focus_set: "Kuratordan kun fokusi",
      one_on_one: "1:1 uchrashuv",
      pause: "Pauza",
      quest: "Kuratordan kvest",
      fee_plan: "Komissiya tarifi",
      concern_note: "Xavotirli eslatma",
      plateau_review: "Tahlil: surʼat kerakligidan past",
      scaling_decision: "Tir boʻyicha qaror",
    },
    trigger: {
      scheduled: "reja boʻyicha",
      after_bad_period: "zaif davrdan keyin",
      plateau: "surʼat kerakligidan past",
      breach: "buzilishdan keyin",
      random: "tasodifiy tanlov",
      trader_request: "treyder iltimosi bilan",
    },
    system: "tizim",
  },
} satisfies Messages<typeof ru>;
