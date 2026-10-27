import { describe, expect, it } from "vitest";
import { overlayPending } from "./storage";

describe("overlayPending", () => {
  const server = { favorites: ["rsi", "vwap"], notes: { rsi: "old note", vwap: "keep" } };
  it("returns the server state when nothing is pending", () => {
    expect(overlayPending(server, { favorites: [], notes: {} }, [])).toBe(server);
  });
  it("keeps unconfirmed local edits on top of the server copy (note changed, favourite added / removed, note cleared)", () => {
    const local = { favorites: ["vwap", "atr"], notes: { rsi: "new note", vwap: "keep" } };
    const out = overlayPending(server, local, ["rsi", "atr"]);
    expect(out.notes.rsi).toBe("new note");
    expect(out.favorites).toEqual(["vwap", "atr"]);
    expect(overlayPending(server, { favorites: ["rsi", "vwap"], notes: { vwap: "keep" } }, ["rsi"]).notes).toEqual({ vwap: "keep" });
  });
});
