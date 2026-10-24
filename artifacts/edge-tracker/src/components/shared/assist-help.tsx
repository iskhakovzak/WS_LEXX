/**
 * «✦ Помочь» — inline help «как в Docs» for a text field (playbook editor, plan, end of day): improve the wording,
 * lay the text out as a setup, fill gaps from linked trades. The assistant returns a suggestion shown as a word diff
 * (added / removed); the field changes only on «Принять». Nothing is saved by the button itself.
 */
import * as React from "react";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/contexts/auth-context";
import { assistantI18n } from "@/i18n/ns/assistant";
import { cn } from "@/lib/utils";
import { assistText, type AssistAction, type AssistField } from "@/lib/assistant/assist-api";
import { sameText, wordDiff } from "@/lib/assistant/diff";
import type { PageContext } from "@/lib/assistant/model";

type State = { s: "menu" } | { s: "loading"; action: AssistAction } | { s: "result"; text: string } | { s: "error"; message: string };

export function AssistHelp({ value, onAccept, field, context, actions, className }: {
  value: string;
  onAccept: (next: string) => void;
  field: AssistField;
  context?: PageContext;
  actions?: readonly AssistAction[];
  className?: string;
}) {
  const { user, can } = useAuth();
  const { t } = assistantI18n.useT();
  const [open, setOpen] = React.useState(false);
  const [state, setState] = React.useState<State>({ s: "menu" });
  const ctl = React.useRef<AbortController | null>(null);
  const list = actions ?? (field === "playbook" ? (["improve", "structure", "fill"] as const) : (["improve", "fill"] as const));
  React.useEffect(() => () => ctl.current?.abort(), []);
  if (!user || user.role === "guest" || !can("assistant.use")) return null;

  const run = async (action: AssistAction) => {
    if (!value.trim() && action !== "fill") { setState({ s: "error", message: t("help.empty") }); return; }
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setState({ s: "loading", action });
    try {
      const r = await assistText({ action, field, text: value, context: { ...(context ?? {}), route: `${window.location.pathname}${window.location.search}`.slice(0, 300) } }, c.signal);
      if (c.signal.aborted) return;
      setState(r.suggestion && !sameText(r.suggestion, value) ? { s: "result", text: r.suggestion } : { s: "error", message: t("help.noChange") });
    } catch (e) {
      if (!c.signal.aborted) setState({ s: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };
  const close = (v: boolean) => {
    setOpen(v);
    if (!v) { ctl.current?.abort(); setState({ s: "menu" }); }
  };

  return (
    <Popover open={open} onOpenChange={close}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className={cn("h-7 min-h-7 gap-1 px-2 text-xs text-primary", className)} aria-label={t("help.title")}>
          {t("help.button")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,26rem)] p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">{t("help.title")}</p>
        {state.s === "menu" || state.s === "error" ? (
          <div className="flex flex-col gap-1">
            {list.map((a) => (
              <Button key={a} type="button" variant="ghost" size="sm" className="justify-start" onClick={() => void run(a)}>{t(`help.${a}`)}</Button>
            ))}
            {state.s === "error" ? <p role="status" className="mt-1 text-xs text-muted-foreground">{state.message}</p> : null}
          </div>
        ) : state.s === "loading" ? (
          <p className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{t("help.loading")}</p>
        ) : (
          <div>
            <p className="mb-1.5 text-2xs text-muted-foreground">{t("help.suggestion")}</p>
            <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2.5 text-sm leading-relaxed [overflow-wrap:anywhere]">
              {wordDiff(value, state.text).map((p, i) => (
                <span key={i} className={p.kind === "add" ? "rounded-sm bg-up/15 text-up" : p.kind === "del" ? "text-down/80 line-through" : undefined}>{p.text}</span>
              ))}
            </div>
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setState({ s: "menu" })}><X aria-hidden="true" />{t("help.reject")}</Button>
              <Button type="button" size="sm" onClick={() => { onAccept(state.text); close(false); }}><Check aria-hidden="true" />{t("help.accept")}</Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
