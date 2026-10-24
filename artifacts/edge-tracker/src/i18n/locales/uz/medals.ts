import type { Messages } from "../../core";
import type ru from "../ru/medals";

export default {
  stageAria: "«{stage}» bosqichi medali",
  stageLockedAria: "«{stage}» bosqichi medali — hali oldinda",
  rimBottom: "WS_LEXX Akademiyasi",
  reveal: {
    eyebrow: "Yangi bosqich",
    title: "Siz endi — {stage}",
    since: "Oʻtkazilgan sana: {date}",
    body: "Medal endi sizniki: u treyder yoʻlida, profilda va odamlar roʻyxatida koʻrinadi. Ballar avvalgidek faqat intizom va oʻqish uchun beriladi.",
    next: "Keyingi bosqich — «{next}».",
    top: "Bu akademiyaning eng yuqori bosqichi.",
    close: "Ajoyib",
  },
} satisfies Messages<typeof ru>;
