import type { Messages } from "../../core";
import type ru from "../ru/medals";

export default {
  stageAria: "{stage} stage medal",
  stageLockedAria: "{stage} stage medal — still ahead",
  rimBottom: "WS_LEXX Academy",
  reveal: {
    eyebrow: "New stage",
    title: "You are a {stage} now",
    since: "Promoted on {date}",
    body: "The medal is yours: it shows on your trader path, in your profile and in the people list. Points still come only from discipline and learning.",
    next: "Next stage: {next}.",
    top: "This is the academy’s top stage.",
    close: "Great",
  },
} satisfies Messages<typeof ru>;
