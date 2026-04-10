import { useState, useCallback, useRef, useEffect } from "react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

type UndoState = {
  id: number;
  section: string;
  label: string;
  timer: ReturnType<typeof setTimeout>;
};

export function useUndoDelete(onRestore?: () => void) {
  const [pending, setPending] = useState<UndoState | null>(null);
  const pendingRef = useRef<UndoState | null>(null);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(() => {
    return () => {
      if (pendingRef.current) clearTimeout(pendingRef.current.timer);
    };
  }, []);

  const scheduleUndo = useCallback((id: number, section: string, label: string) => {
    if (pendingRef.current) clearTimeout(pendingRef.current.timer);

    const timer = setTimeout(() => {
      setPending(null);
    }, 8000);

    setPending({ id, section, label, timer });
  }, []);

  const restore = useCallback(async () => {
    if (!pending) return;
    clearTimeout(pending.timer);
    try {
      await fetch(`${BASE}/api/${pending.section}/${pending.id}/restore`, { method: "POST" });
      onRestore?.();
    } catch (e) {}
    setPending(null);
  }, [pending, onRestore]);

  const dismiss = useCallback(() => {
    if (pending) clearTimeout(pending.timer);
    setPending(null);
  }, [pending]);

  return { pending, scheduleUndo, restore, dismiss };
}
