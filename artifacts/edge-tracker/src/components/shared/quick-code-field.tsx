/**
 * The quick-unlock code input («код быстрого входа»): masked, with a show / hide toggle and the rule under it. Used by
 * Settings → Безопасность and the first-lock prompt (components/lock). Password managers are told to stay away: it is
 * not an account password.
 */
import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { quickCodeKind } from "@/lib/lock/quick-code-api";
import { lockI18n } from "@/i18n/ns/lock";

export function QuickCodeField({
  id, value, onChange, onSubmit, autoFocus, invalid, className,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  autoFocus?: boolean;
  /** Show the rule as an error (after a failed save). */
  invalid?: boolean;
  className?: string;
}) {
  const { t } = lockI18n.useT();
  const [shown, setShown] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  // Opened on purpose («Задать код», the first-lock prompt): the field is the only task there.
  React.useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);
  const ruleId = `${id}-rule`;
  const digits = /^\d*$/.test(value);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="relative">
        <input
          id={id}
          type={shown ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, 32))}
          onKeyDown={(e) => { if (e.key === "Enter" && onSubmit) { e.preventDefault(); onSubmit(); } }}
          inputMode={digits ? "numeric" : "text"}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore=""
          data-lpignore="true"
          ref={inputRef}
          placeholder={t("code.placeholder")}
          aria-describedby={ruleId}
          aria-invalid={invalid || undefined}
          className="glass-field h-10 w-full rounded-full pl-4 pr-11 text-base tracking-[0.2em] placeholder:tracking-normal placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 md:text-sm"
        />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? t("code.hide") : t("code.show")}
          aria-pressed={shown}
          className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {shown ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      <p id={ruleId} className={cn("px-1 text-xs", invalid ? "text-down" : "text-muted-foreground")}>
        {invalid ? t("code.invalid") : t("code.rule")}
      </p>
    </div>
  );
}

/** Is the typed code acceptable (same rule as the server)? */
export const isQuickCodeValid = (v: string) => quickCodeKind(v) !== null;
