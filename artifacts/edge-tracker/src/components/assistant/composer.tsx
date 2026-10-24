/** The question box: Enter sends, Shift+Enter breaks the line; while an answer streams the button stops it. */
import * as React from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { assistantI18n } from "@/i18n/ns/assistant";
import { cn } from "@/lib/utils";

export function Composer({ value, onChange, onSend, onStop, busy, disabled, inputRef }: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  disabled?: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const { t } = assistantI18n.useT();
  // Auto-height up to ~6 lines.
  React.useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value, inputRef]);
  return (
    <div className="glass-field flex items-end gap-2 rounded-2xl p-1.5 pl-3 focus-within:ring-2 focus-within:ring-ring">
      <label htmlFor="assistant-input" className="sr-only">{t("placeholder")}</label>
      <textarea
        id="assistant-input"
        ref={inputRef}
        rows={1}
        value={value}
        disabled={disabled}
        placeholder={t("placeholder")}
        aria-describedby="assistant-input-hint"
        maxLength={8000}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (!busy) onSend();
          }
        }}
        className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
      />
      {busy ? (
        <Button type="button" size="icon" variant="secondary" onClick={onStop} title={t("stop")} aria-label={t("stop")}><Square aria-hidden="true" /></Button>
      ) : (
        <Button type="button" size="icon" onClick={onSend} disabled={disabled || !value.trim()} title={t("send")} aria-label={t("send")} className={cn(!value.trim() && "opacity-60")}>
          <ArrowUp aria-hidden="true" />
        </Button>
      )}
      <span id="assistant-input-hint" className="sr-only">{t("composerHint")}</span>
    </div>
  );
}
