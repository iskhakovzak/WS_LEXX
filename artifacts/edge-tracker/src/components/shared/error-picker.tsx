/**
 * ErrorPicker — the ONE mistakes picker (Волна 2, item 2.8): the trade card («Обзор» → разметка), the journal's per-trade
 * review and «Правила → Ошибки» (the quick-log dialog). One vocabulary (components/shared/error-vocab.ts, same as the
 * server), shown in the UI language; whatever is picked lands in the one errors store (trading_errors) on the server.
 *
 * Chips toggle (multi) or pick one (`single`). Fewer choices: the first `visible` codes, the rest behind «Ещё N»
 * (picked ones are always shown). `size="sm"` for dense rows (journal review), default for sheets and dialogs.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { rulesI18n } from "@/i18n/ns/rules";
import { ERROR_CODES, errorHint, errorLabel, severityOf, type ErrorCode } from "./error-vocab";

/** Most frequent first (the default order of the chips). */
const ORDER: readonly ErrorCode[] = [
  "fomo", "earlyEntry", "revenge", "overtrading", "movedStop", "oversize", "offPlan", "earlyExit",
  "lateExit", "offSetup", "noStop", "averagingDown", "heldLoser", "ignoredNews",
];

export type ErrorPickerProps = {
  /** Picked codes. */
  value: readonly ErrorCode[];
  /** Toggle (multi) / pick (single) one code; `on` = the new state. Omitted ⇒ read-only. */
  onChange?: (code: ErrorCode, on: boolean) => void;
  single?: boolean;
  disabled?: boolean;
  /** Codes shown before «Ещё N» (default 8; picked codes are always shown). */
  visible?: number;
  size?: "sm" | "md";
  className?: string;
  "aria-labelledby"?: string;
};

export function ErrorPicker({ value, onChange, single, disabled, visible = 8, size = "md", className, ...aria }: ErrorPickerProps) {
  const { t } = rulesI18n.useT();
  const [all, setAll] = React.useState(false);
  const picked = new Set(value);
  const readOnly = !onChange || disabled;
  const order = ORDER.filter((c) => (ERROR_CODES as readonly string[]).includes(c));
  const shown = readOnly ? order.filter((c) => picked.has(c)) : all ? order : order.filter((c, i) => i < visible || picked.has(c));
  const hidden = readOnly ? 0 : order.length - shown.length;
  if (readOnly && !shown.length) return <span className={cn("text-xs text-muted-foreground", className)}>—</span>;
  return (
    <div role="group" aria-label={aria["aria-labelledby"] ? undefined : t("errorPicker.aria")} aria-labelledby={aria["aria-labelledby"]} className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {shown.map((code) => {
        const on = picked.has(code);
        const severe = severityOf(code) === "high" || severityOf(code) === "critical";
        return (
          <button
            key={code}
            type="button"
            role={single ? "radio" : undefined}
            aria-checked={single ? on : undefined}
            aria-pressed={single ? undefined : on}
            disabled={readOnly}
            title={errorHint(code)}
            onClick={() => onChange?.(code, single ? true : !on)}
            className={cn(
              "chip font-medium disabled:cursor-default",
              size === "sm" ? "min-h-6 px-2 text-2xs" : "min-h-8 px-2.5 text-xs",
              on && (severe ? "!border-transparent !bg-down/15 !text-down" : "!border-transparent !bg-warn/15 !text-warn"),
            )}
          >
            {errorLabel(code)}
          </button>
        );
      })}
      {!readOnly && (hidden > 0 || all) && (
        <button type="button" onClick={() => setAll((v) => !v)} className={cn("rounded-full px-2 text-muted-foreground hover:text-foreground", size === "sm" ? "text-2xs" : "text-xs")}>
          {all ? t("errorPicker.less") : t("errorPicker.more", { count: hidden })}
        </button>
      )}
    </div>
  );
}
