import { describe, expect, it } from "vitest";
import { asQuoteLang, citationOf, quotePlainText } from "../format";
import { rotationCurrent } from "../store";
import type { Quote } from "../types";

const q: Quote = {
  id: "il-012", cat: "olympus", tags: ["courage"], author: "homer", work: "iliad", loc: "9.312", rel: "verified",
  text: "T", authorName: "A", workName: "W",
};

describe("quote format", () => {
  it("writes the citation and the clipboard text with the language's marks", () => {
    expect(citationOf(q)).toBe("W, 9.312");
    expect(citationOf({ ...q, loc: "" })).toBe("W");
    expect(quotePlainText(q, "ru")).toBe("«T»\n— A · W, 9.312");
    expect(quotePlainText(q, "en").startsWith("“T”")).toBe(true);
    expect(asQuoteLang("uz")).toBe("uz");
    expect(asQuoteLang("de")).toBe("ru");
  });

  it("reads the quote on screen of a stored cycle", () => {
    expect(rotationCurrent({ v: 1, cycle: 0, seen: ["a"], current: { id: "a", slot: "2026-10-29" } })).toEqual({ id: "a", slot: "2026-10-29" });
    expect(rotationCurrent(null)).toBeNull();
    expect(rotationCurrent({ current: { id: 1 } })).toBeNull();
  });
});
