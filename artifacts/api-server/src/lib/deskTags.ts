/**
 * «Глобальные теги» of the /trades and /stats facets (lib/tradeFacetsSql): tags the desk writes for everyone — the IMX
 * mark (lib/imx) and the one mistakes vocabulary (lib/tradingErrors ERROR_VOCAB: canonical words and old spellings, which
 * key M and the journal mirror into trades.tags). Every other tag is a trader's personal one («Личные теги»).
 */
import { IMX_TAG } from "./imx";
import { ERROR_VOCAB } from "./tradingErrors";

export const DESK_TAGS: readonly string[] = [...new Set([IMX_TAG, ...ERROR_VOCAB.flatMap((v) => [v.canonical, ...v.aliases])])];
const DESK_LOWER = new Set(DESK_TAGS.map((t) => t.toLowerCase()));

export function isDeskTag(tag: string): boolean {
  return DESK_LOWER.has(tag.trim().toLowerCase());
}
