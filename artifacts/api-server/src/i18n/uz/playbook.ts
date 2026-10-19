import type { Messages } from "../core";
import type ru from "../ru/playbook";

export default {
  suggest: {
    linked: "Savdo allaqachon setapga bogʻlangan",
    linkedHere: "Savdo shu setapga bogʻlangan",
    auto: "Avtoklassifikatsiya: {label}",
    text: "Nomi savdo belgisi «{label}» ga oʻxshaydi",
    strategy: "«{label}» strategiyasi, kirish {time} NY — shu setap oynasi",
    time: "Kirish {time} NY — shu setap oynasi",
  },
} satisfies Messages<typeof ru>;
