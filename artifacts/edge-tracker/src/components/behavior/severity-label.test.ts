import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { severityLabel } from "./api";

describe("pattern severity pill (Роман: «не стоит денег −$167»)", () => {
  afterEach(async () => { await setLang("ru", { source: "init" }); });
  it("a negative cost on too few trades reads «мало случаев»", async () => {
    await setLang("ru", { source: "init" });
    expect(severityLabel({ severity: "none", cost: -167.3 })).toBe("мало случаев");
  });
  it("no cost / a positive cost keeps «не стоит денег»; real severities keep their label", async () => {
    await setLang("ru", { source: "init" });
    expect(severityLabel({ severity: "none", cost: 12 })).toBe("не стоит денег");
    expect(severityLabel({ severity: "none", cost: null })).toBe("не стоит денег");
    expect(severityLabel({ severity: "high", cost: -900 })).toBe("высокая");
  });
});
