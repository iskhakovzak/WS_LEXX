import { describe, expect, it } from "vitest";
import { nextWard } from "./api";

describe("nextWard (OLGA-11: «Сохранить и следующий»)", () => {
  const wards = ["Евгений Л.", "Денис Ф.", "Никита С."];
  it("the next ward in name order that is not reviewed, wrapping around", () => {
    expect(nextWard(wards, "Денис Ф.", new Set())).toBe("Евгений Л.");
    expect(nextWard(wards, "Денис Ф.", new Set(["Евгений Л."]))).toBe("Никита С.");
    expect(nextWard(wards, "Никита С.", new Set())).toBe("Денис Ф.");
  });
  it("null when the others are done; a non-ward current starts from the top", () => {
    expect(nextWard(wards, "Денис Ф.", new Set(["Евгений Л.", "Никита С."]))).toBeNull();
    expect(nextWard(wards, "Максим Р.", new Set(["Денис Ф."]))).toBe("Евгений Л.");
  });
});
