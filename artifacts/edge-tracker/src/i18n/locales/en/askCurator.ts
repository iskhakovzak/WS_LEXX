import type { Messages } from "../../core";
import type ru from "../ru/askCurator";

export default {
  button: {
    limits: "Ask for limits",
    group: "Ask to join a group",
    stage: "Ask for a stage",
    plan: "Ask for the desk plan",
    other: "Ask the curator",
  },
  prefill: {
    limits: "Please set my risk limits",
    group: "Please add me to a learning group",
    stage: "Please assign my stage",
    plan: "There is no desk plan today — please publish one",
    other: "",
  },
  dialogTitle: "Request to the curator",
  dialogHint: "Your curator sees the request in the cabinet and answers with a notification.",
  messageLabel: "Comment",
  send: "Send",
  cancel: "Cancel",
  sent: "Request sent — your curator will see it in the cabinet",
  pending: "Request sent",
  pendingHint: "Your curator has seen it since {date}",
  failed: "Could not send the request",
  panel: {
    title: "Requests",
    empty: "No new requests",
    kind: {
      limits: "Limits",
      group: "Learning group",
      stage: "Stage",
      plan: "Desk plan",
      other: "Other",
    },
    noMessage: "No comment",
    done: "Done",
    dismiss: "Close",
    notePh: "Answer to the trader (optional)",
    open: "Open",
    resolved: "Request closed — the trader gets a notification",
    failed: "Could not close the request",
  },
} satisfies Messages<typeof ru>;
