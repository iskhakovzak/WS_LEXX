import React, { useEffect, useState } from "react";
import { Undo2, X } from "lucide-react";

type Props = {
  label: string;
  onUndo: () => void;
  onDismiss: () => void;
  durationMs?: number;
};

export function UndoToast({ label, onUndo, onDismiss, durationMs = 8000 }: Props) {
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.max(0, 100 - (elapsed / durationMs) * 100);
      setProgress(pct);
      if (pct <= 0) clearInterval(interval);
    }, 50);
    return () => clearInterval(interval);
  }, [durationMs]);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="bg-card border border-border shadow-2xl flex items-center gap-3 px-4 py-3 min-w-[300px] max-w-[400px] relative overflow-hidden">
        <div
          className="absolute bottom-0 left-0 h-[2px] bg-primary/60 transition-all"
          style={{ width: `${progress}%` }}
        />
        <span className="text-sm font-mono text-foreground flex-1 truncate">
          {label} <span className="text-muted-foreground">удалено</span>
        </span>
        <button
          onClick={onUndo}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold uppercase tracking-wider text-primary hover:bg-primary/10 border border-primary/30 transition-colors"
        >
          <Undo2 className="h-3.5 w-3.5" />
          Отменить
        </button>
        <button
          onClick={onDismiss}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
