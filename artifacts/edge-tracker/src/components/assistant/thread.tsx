/**
 * The conversation: the person's questions, the assistant's answers (streaming markdown, the model as a tiny label,
 * tool chips «смотрю ваши сделки…», draft cards, errors), and the starter prompts of the page when it is empty.
 */
import * as React from "react";
import { AlertCircle, Check, Copy, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { assistantI18n } from "@/i18n/ns/assistant";
import { cn } from "@/lib/utils";
import { modelLabel, STARTERS, type ChatMessage, type PageKey, type Starter, type ToolChip } from "@/lib/assistant/model";
import { AnswerMarkdown } from "./answer-markdown";
import { DraftCardView } from "./draft-card";

type ToolKey = Parameters<typeof assistantI18n.t>[0] & `tools.${string}`;
type ReasonKey = Parameters<typeof assistantI18n.t>[0] & `reasons.${string}`;

function Chip({ chip }: { chip: ToolChip }) {
  const { t } = assistantI18n.useT();
  const label = assistantI18n.tryT(`tools.${chip.name}`) ?? t("tools.unknown" as ToolKey);
  return (
    <li className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs",
      chip.status === "error" ? "border-destructive/30 text-destructive" : "border-[var(--glass-border)] text-muted-foreground",
    )}>
      {chip.status === "start" ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        : chip.status === "done" ? <Check className="h-3 w-3 text-up" aria-hidden="true" />
        : <AlertCircle className="h-3 w-3" aria-hidden="true" />}
      <span>{chip.status === "error" ? `${label} · ${t("tools.failed")}` : label}</span>
    </li>
  );
}

function ModelTag({ m }: { m: ChatMessage }) {
  const { t } = assistantI18n.useT();
  if (!m.model) return null;
  const reason = m.reason ? assistantI18n.tryT(`reasons.${m.reason}` as ReasonKey) : "";
  return (
    <p className="mb-1 flex items-center gap-1 text-[0.6875rem] text-muted-foreground" title={m.model}>
      <Sparkles className="h-3 w-3" aria-hidden="true" />
      <span>{modelLabel(m.model)}</span>
      {reason ? <span>· {reason}</span> : null}
      {m.status === "stopped" ? <span>· {t("stopped")}</span> : null}
    </p>
  );
}

function CopyButton({ text }: { text: string }) {
  const { t } = assistantI18n.useT();
  const [done, setDone] = React.useState(false);
  return (
    <Button
      variant="ghost" size="icon-sm" title={done ? t("copied") : t("copy")} aria-label={done ? t("copied") : t("copy")}
      onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1500); }); }}
    >
      {done ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </Button>
  );
}

function AssistantBubble({ m, onRetry, onNavigate }: { m: ChatMessage; onRetry?: () => void; onNavigate: () => void }) {
  const { t } = assistantI18n.useT();
  const waiting = m.status === "streaming" && !m.text && !m.chips.length;
  return (
    <article className="max-w-full" aria-busy={m.status === "streaming"}>
      <ModelTag m={m} />
      {m.chips.length ? <ul className="mb-1.5 flex flex-wrap gap-1.5" aria-label={t("thinking")}>{m.chips.map((c) => <Chip key={c.id} chip={c} />)}</ul> : null}
      {waiting ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />{t("thinking")}</p>
      ) : null}
      {m.text ? <AnswerMarkdown text={m.text} onNavigate={onNavigate} /> : null}
      {m.drafts.map((d) => <DraftCardView key={d.id} card={d} />)}
      {m.status === "error" && m.error ? (
        <div role="alert" className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
          <p className="font-medium">{t("errorTitle")}</p>
          <p className="mt-0.5">{m.error.message}</p>
          {onRetry ? <Button size="sm" variant="outline" className="mt-2" onClick={onRetry}><RotateCcw aria-hidden="true" />{t("retry")}</Button> : null}
        </div>
      ) : null}
      {m.status === "done" && m.text ? <div className="mt-1 flex justify-end"><CopyButton text={m.text} /></div> : null}
    </article>
  );
}

export function Starters({ page, onPick }: { page: PageKey; onPick: (text: string, s: Starter) => void }) {
  const { t } = assistantI18n.useT();
  return (
    <div className="flex flex-col items-start gap-3 py-2">
      <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/12 text-primary"><Sparkles className="h-5 w-5" aria-hidden="true" /></div>
      <div>
        <h3 className="text-base font-semibold text-foreground">{t("empty.title")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t("empty.body")}</p>
      </div>
      <ul className="flex w-full flex-col gap-2">
        {STARTERS[page].map((s) => {
          const text = t(`starters.${page}.${s.key}`);
          return (
            <li key={s.key}>
              <button type="button" onClick={() => onPick(text, s)} className="glass-field w-full rounded-xl px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:ring-2 focus-visible:ring-ring">
                {text}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Thread({ messages, onRetry, onNavigate }: { messages: ChatMessage[]; onRetry: (question: string) => void; onNavigate: () => void }) {
  const { t } = assistantI18n.useT();
  return (
    <ol className="flex flex-col gap-4" aria-live="polite" aria-relevant="additions text">
      {messages.map((m, i) => (
        <li key={m.key} className={cn(m.role === "user" ? "self-end max-w-[85%]" : "self-stretch")}>
          {m.role === "user" ? (
            <div className="rounded-2xl rounded-br-md bg-primary-solid/90 px-3 py-2 text-sm text-primary-foreground [overflow-wrap:anywhere]">
              <span className="sr-only">{t("you")}: </span>{m.text}
            </div>
          ) : (
            <AssistantBubble
              m={m}
              onNavigate={onNavigate}
              onRetry={messages[i - 1]?.role === "user" && i === messages.length - 1 ? () => onRetry(messages[i - 1]!.text) : undefined}
            />
          )}
        </li>
      ))}
    </ol>
  );
}
