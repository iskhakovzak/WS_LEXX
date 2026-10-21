/**
 * Who sees other traders' real names on cross-trader screens (top of the day, desk-day chart, season ranking,
 * recognition feed, trainer daily ranking). One helper for every alias path (owner 2026-10-21: «синьорам можно видеть
 * даже имена, а другим нет»):
 *
 *   staff (curator / admin)            always names
 *   a trader / guest                   names when their stage is in privacy.namesVisibleTo, else day aliases
 *
 * privacy.namesVisibleTo never saved → the legacy switch privacy.hideNamesFromTraders decides (on → nobody, off → every
 * stage), so nothing changes on deploy. Every stage listed → everybody non-staff sees names without a stage lookup
 * (exactly the old «off»). Money is a separate rule (lib/moneyVisibility): names never open somebody else's $.
 */
import { setting, settingStored } from "../settings/registry";
import { ACCESS_STAGES, viewerStage, type AccessStage } from "./stage";

/** The stages that see names now (the saved list, or the legacy switch's meaning while none is saved). */
export function namesVisibleStages(): readonly AccessStage[] {
  if (settingStored("privacy.namesVisibleTo")) return setting("privacy.namesVisibleTo");
  return setting("privacy.hideNamesFromTraders") ? [] : ACCESS_STAGES;
}

/** Pure rule: staff → true; otherwise the stage must be in `list`. */
export function namesVisibleFor(v: { staff: boolean; stage: AccessStage | null }, list: readonly AccessStage[] = namesVisibleStages()): boolean {
  if (v.staff) return true;
  if (list.length >= ACCESS_STAGES.length) return true;
  return !!v.stage && list.includes(v.stage);
}

/** Does this viewer see other traders' real names? (Reads the viewer's stage only when the list is partial.) */
export async function namesVisible(viewer: { name: string | null; staff: boolean }): Promise<boolean> {
  if (viewer.staff) return true;
  const list = namesVisibleStages();
  if (!list.length) return false;
  if (list.length >= ACCESS_STAGES.length) return true;
  if (!viewer.name) return false;
  return namesVisibleFor({ staff: false, stage: await viewerStage(viewer.name) }, list);
}
