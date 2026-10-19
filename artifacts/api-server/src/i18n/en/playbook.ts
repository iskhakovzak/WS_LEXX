import type { Messages } from "../core";
import type ru from "../ru/playbook";

export default {
  suggest: {
    linked: "The trade is already linked to the setup",
    linkedHere: "The trade is linked to this setup",
    auto: "Auto-classification: {label}",
    text: "The name looks like the trade label “{label}”",
    strategy: "Strategy “{label}”, entry at {time} NY — this setup's window",
    time: "Entry at {time} NY — this setup's window",
  },
} satisfies Messages<typeof ru>;
