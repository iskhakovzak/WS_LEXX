import type { Messages } from "../../core";
import type ru from "../ru/deskGroups";

export default {
  title: "Guruhlar",
  description: "Desk guruhlarga boʻlingan. Kurator sukut boʻyicha oʻz guruhini koʻradi — navbatda, kabinetda va Akademiyada; «Hammasi» butun deskni koʻrsatadi.",
  loadFailed: "Guruhlarni yuklab boʻlmadi",
  denied: "Guruhlarni faqat xodimlar koʻradi",
  newName: "Yangi guruh nomi",
  add: "Guruh qoʻshish",
  curator: "Kurator",
  noCurator: "Kuratorsiz",
  ungrouped: "Guruhsiz",
  ungroupedHint: "Hali taqsimlanmagan treyderlar",
  empty: "Guruhda hali hech kim yoʻq",
  members: { one: "{count} treyder", other: "{count} treyder" },
  moveTo: "{name}ni koʻchirish",
  rename: "Nomini oʻzgartirish",
  save: "Saqlash",
  cancel: "Bekor qilish",
  archive: "Arxivga",
  archiveConfirm: "Arxivlansinmi? Treyderlar «Guruhsiz» boʻladi",
  saved: "Saqlandi",
  saveFailed: "Saqlab boʻlmadi",
  readOnly: "Guruhlarni admin oʻzgartiradi (Pult → Desk sozlamalari)",
} satisfies Messages<typeof ru>;
