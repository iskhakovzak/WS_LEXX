import { describe, expect, it } from "vitest";
import { openRequestOf, type CuratorRequest } from "./ask-curator";
import { requestsScope } from "@/components/curator/requests-panel";

const r = (over: Partial<CuratorRequest>): CuratorRequest => ({
  id: 1, trader: "chert", traderId: 144, kind: "limits", message: "", status: "open", note: null, createdAt: "2026-10-20T14:00:00Z", resolvedAt: null, resolvedBy: null, ...over,
});

describe("«Попросить куратора» (Волна 1 п. 1.1)", () => {
  it("the button shows «Запрос отправлен» only for an open request of its kind", () => {
    const list = [r({ id: 1, kind: "limits", status: "done" }), r({ id: 2, kind: "group" })];
    expect(openRequestOf(list, "limits")).toBeNull();
    expect(openRequestOf(list, "group")?.id).toBe(2);
    expect(openRequestOf(undefined, "plan")).toBeNull();
  });
  it("cabinet scope → «Моя группа / Все» of the API (auto = the server default)", () => {
    expect(requestsScope("mine")).toBe("group");
    expect(requestsScope("desk")).toBe("all");
    expect(requestsScope("auto")).toBeNull();
  });
});
