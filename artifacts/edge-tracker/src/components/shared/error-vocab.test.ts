import { describe, expect, it } from "vitest";
import { ERROR_CODES, ERROR_VOCAB, canonicalOf, codesOfWords, errorCodeOf, errorLabel, withErrorCode } from "./error-vocab";
import { classifyTags, hasTag, toggleTag } from "@/components/trades/review-presets";
import { tagLabel } from "./trade-labels";
import { MISTAKE_CATEGORIES, mistakeLabel } from "@/components/rules/constants";

describe("one mistakes vocabulary (Волна 2 п. 2.8)", () => {
  it("every code has one entry and a label; old spellings map to the same code", () => {
    expect(ERROR_VOCAB.map((e) => e.code)).toEqual([...ERROR_CODES]);
    for (const c of ERROR_CODES) expect(errorLabel(c)).toBeTruthy();
    expect(errorCodeOf("FOMO")).toBe("fomo");
    expect(errorCodeOf("fomo / погоня")).toBe("fomo");
    expect(errorCodeOf("Реванш")).toBe("revenge");
    expect(errorCodeOf("Большой размер")).toBe("oversize");
    expect(errorCodeOf("Страх")).toBeNull();
    expect(codesOfWords(["FOMO", "Страх", "FOMO / погоня", "Двигал стоп"])).toEqual(["fomo", "movedStop"]);
  });

  it("toggling by code: a spelling counts as present, off removes every spelling", () => {
    expect(withErrorCode(["Страх"], "fomo", true)).toEqual(["Страх", "FOMO / погоня"]);
    expect(withErrorCode(["FOMO"], "fomo", true)).toEqual(["FOMO"]);
    expect(toggleTag("FOMO, Страх", canonicalOf("fomo"))).toBe("Страх");
    expect(toggleTag("Страх", canonicalOf("revenge"))).toBe("Страх, Отыгрыш после убытка");
    expect(hasTag("Реванш", "Отыгрыш после убытка")).toBe(true);
    expect(classifyTags("Реванш, Страх, my").mistakes).toEqual(["Реванш"]);
  });

  it("every screen shows one label for any spelling (trades chips, journal, «Ошибки»)", () => {
    expect(tagLabel("Реванш")).toBe(errorLabel("revenge"));
    expect(tagLabel("Отыгрыш после убытка")).toBe(errorLabel("revenge"));
    expect(mistakeLabel("Двигал стоп")).toBe(errorLabel("movedStop"));
    expect(MISTAKE_CATEGORIES.map((c) => c.value)).toEqual(ERROR_VOCAB.map((e) => e.canonical));
  });
});
