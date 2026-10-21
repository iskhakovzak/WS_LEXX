import { describe, expect, it } from "vitest";
import { openRequestOf, reviewLink, type CuratorRequest } from "./ask-curator";
import { canReportTask } from "@/components/shared/curator-task-done";
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
  it("«Попросить разбор» (2.13): one open request per thread, the link has the server's shape", () => {
    expect(reviewLink("discussion", 7)).toBe("/discussions?thread=7");
    expect(reviewLink("idea", 3)).toBe("/trade-ideas?idea=3");
    const list = [r({ id: 5, kind: "review", link: "/discussions?thread=7" })];
    expect(openRequestOf(list, "review", "/discussions?thread=7")?.id).toBe(5);
    expect(openRequestOf(list, "review", "/discussions?thread=8")).toBeNull();
  });
  it("«Готово» on a curator task: only an active manual task not yet reported", () => {
    expect(canReportTask({ template: "curator_task", status: "active" })).toBe(true);
    expect(canReportTask({ template: "curator_task", status: "active", reportedOn: "2026-10-20" })).toBe(false);
    expect(canReportTask({ template: "curator_task", status: "done" })).toBe(false);
    expect(canReportTask({ template: "review_days", status: "active" })).toBe(false);
  });
  it("cabinet scope → «Моя группа / Все» of the API (auto = the server default)", () => {
    expect(requestsScope("mine")).toBe("group");
    expect(requestsScope("desk")).toBe("all");
    expect(requestsScope("auto")).toBeNull();
  });
});
