import { describe, expect, it, vi } from "vitest";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { optimistic } from "./optimistic";

type Item = { id: number; done: boolean };
const KEY = ["items"] as const;

function setup() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  qc.setQueryData<Item[]>([...KEY, "open"], [{ id: 1, done: false }, { id: 2, done: false }]);
  qc.setQueryData<Item[]>([...KEY, "all"], [{ id: 1, done: false }]);
  return qc;
}

const toggle = (old: Item[], id: number) => old.map((i) => (i.id === id ? { ...i, done: !i.done } : i));

describe("optimistic", () => {
  it("patches every cached variant at click time, before the server answers", async () => {
    const qc = setup();
    let resolve!: () => void;
    const onError = vi.fn();
    const m = new MutationObserver(qc, {
      mutationFn: (_id: number) => new Promise<void>((r) => { resolve = r; }),
      ...optimistic<number, Item[]>(qc, { queryKey: KEY, update: toggle, onError }),
    });
    const run = m.mutate(1);
    await vi.waitFor(() => expect(qc.getQueryData<Item[]>([...KEY, "open"])?.[0].done).toBe(true));
    expect(qc.getQueryData<Item[]>([...KEY, "all"])?.[0].done).toBe(true);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    resolve();
    await run;
    expect(onError).not.toHaveBeenCalled();
    expect(qc.getQueryData<Item[]>([...KEY, "open"])?.[0].done).toBe(true);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: KEY });
  });

  it("rolls every patched query back and reports the error when the write fails", async () => {
    const qc = setup();
    const onError = vi.fn();
    const m = new MutationObserver(qc, {
      mutationFn: (_id: number) => Promise.reject(new Error("boom")),
      ...optimistic<number, Item[]>(qc, { queryKey: KEY, update: toggle, invalidate: [["other"]], onError }),
    });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    await expect(m.mutate(2)).rejects.toThrow("boom");
    expect(qc.getQueryData<Item[]>([...KEY, "open"])).toEqual([{ id: 1, done: false }, { id: 2, done: false }]);
    expect(qc.getQueryData<Item[]>([...KEY, "all"])).toEqual([{ id: 1, done: false }]);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }), 2);
    // Settled either way: the server truth is refetched for the patched key and the extra ones.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: KEY });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["other"] });
  });

  it("leaves queries without data alone", async () => {
    const qc = new QueryClient();
    const update = vi.fn((old: Item[]) => old);
    const o = optimistic<number, Item[]>(qc, { queryKey: KEY, update });
    const snapshot = await o.onMutate(1);
    expect(snapshot).toEqual([]);
    expect(update).not.toHaveBeenCalled();
  });
});
