import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { tierDisplay } from "./tier-labels";

afterEach(async () => { await setLang("ru", { source: "init" }); });

describe("tierDisplay", () => {
  it("translates the desk ladder, keeps other names", async () => {
    expect(tierDisplay("Джун")).toBe("Джун");
    await setLang("en", { source: "init" });
    expect(tierDisplay("Джун")).toBe("Junior");
    expect(tierDisplay("senior")).toBe("Senior");
    expect(tierDisplay("Проп 50k")).toBe("Проп 50k");
    expect(tierDisplay(null)).toBe("");
  });
});
