/**
 * The viewer's ladder stage as the stage-dependent access rules see it (owner 2026-10-21: «блокировать разделы или
 * имена по званию»): junior / trader / senior. One resolution with the shell menu and the playbook locks
 * (lib/playbookToday/tier viewerTier → lib/people/stage), mapped onto the three rungs the admin table shows:
 * a legacy «trainee» and a trader without any stage are junior (DEFAULT_STAGE), «lead» counts as senior.
 * Staff (curator / admin) have no stage: they are never restricted.
 */
import { viewerTier } from "../playbookToday/tier";
import { ACCESS_STAGES } from "../settings/validate";
import type { AccessStage } from "../settings/registry";

export { ACCESS_STAGES };
export type { AccessStage };

/** A ladder tier (playbook TIER_KEYS) → access stage; unknown / none → junior (the default stage). */
export function accessStageOf(tier: string | null | undefined): AccessStage {
  if (tier === "trader") return "trader";
  if (tier === "senior" || tier === "lead") return "senior";
  return "junior";
}

/** Stage of a non-staff viewer (cached per name by viewerTier); a viewer without a name (guest) counts as junior. */
export async function viewerStage(name: string | null | undefined): Promise<AccessStage> {
  return accessStageOf(name ? await viewerTier(name) : null);
}
