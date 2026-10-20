/**
 * What the chain / advisor / B-S views hand over to each other (state lives in OptionsSection). Kept apart from the
 * components so the views import these types without an import cycle through OptionsSection.
 */
export type UseInBsParams = { symbol: string; spot: number; strike: number; side: "call" | "put"; days: number; iv: number | null; premium: number; contracts: number };

export type OpenInBuilderParams = {
  symbol: string;
  spot: number;
  days: number;
  iv: number | null;
  legs: { side: "buy" | "sell"; kind: "call" | "put" | "stock"; strike: number; premium: number; qty: number }[];
  append?: boolean;
};

/** "Pick" in the strike ladder: the B-S form gets the contract, the builder gets it as a new leg (IV `builderIv`). */
export type PickContractParams = UseInBsParams & { builderIv: number | null };
