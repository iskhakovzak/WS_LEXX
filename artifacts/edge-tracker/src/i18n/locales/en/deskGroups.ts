import type { Messages } from "../../core";
import type ru from "../ru/deskGroups";

export default {
  title: "Groups",
  description: "The desk is split into groups. A curator sees his group by default — in the queue, the cabinet and the Academy; «All» shows the whole desk.",
  loadFailed: "Could not load the groups",
  denied: "Only staff see the groups",
  newName: "New group name",
  add: "Add group",
  curator: "Curator",
  noCurator: "No curator",
  ungrouped: "No group",
  ungroupedHint: "Traders not placed yet",
  empty: "Nobody in this group yet",
  members: { one: "{count} trader", other: "{count} traders" },
  moveTo: "Move {name}",
  rename: "Rename",
  save: "Save",
  cancel: "Cancel",
  archive: "Archive",
  archiveConfirm: "Archive it? Its traders go to «No group»",
  saved: "Saved",
  saveFailed: "Could not save",
  readOnly: "Groups are changed by an admin (Console → Desk settings)",
} satisfies Messages<typeof ru>;
