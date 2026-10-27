/**
 * The conversation: the person's questions, the assistant's answers (streaming markdown, the WS mark with a tiny ⚡ for
 * boosted / deep answers — never a model name, tool chips «looking at your trades…», the «deep analysis» chip while the
 * advisor is consulted, draft cards, errors), and the starter prompts of the page when it is empty.
 */
import * as React from "react";
import { AlertCircle, Check, Copy, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { assistantI18n } from "@/i18n/ns/assistant";
import { cn } from "@/lib/utils";
import { STARTERS, type ChatMessage, type PageKey, type Starter, type ToolChip } from "@/lib/assistant/model";
import { WsMark } from "@/components/shared/ws-mark";
import { AnswerMarkdown } from "./answer-markdown";
import { DraftCardView } from "./draft-card";
import { TierMark } from "./boost";

type ToolKey = Parameters<typeof assistantI18n.t>[0] & `tools.${string}`;

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

/** The answer's mark: the WS mark, a tiny ⚡ for a boosted / deep answer, «stopped». Never a model name. */
function AnswerTag({ m }: { m: ChatMessage }) {
  const { t } = assistantI18n.useT();
  return (
    <p className="mb-1 flex items-center gap-1.5 text-2xs text-muted-foreground">
      <WsMark className="h-3.5 w-3.5" still={m.status !== "streaming"} />
      <TierMark tier={m.tier} />
      {m.status === "stopped" ? <span>· {t("stopped")}</span> : null}
    </p>
  );
}

/** «Deep analysis…» while the advisor is consulted (no model named). */
function AdvisorChip({ status }: { status: ChatMessage["advising"] }) {
  const { t } = assistantI18n.useT();
  if (!status || status === "error") return null;
  return (
    <li className="inline-flex items-center gap-1.5 rounded-full border border-[var(--glass-border)] px-2 py-0.5 text-2xs text-muted-foreground">
      {status === "start" ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check className="h-3 w-3 text-up" aria-hidden="true" />}
      <span>{status === "start" ? t("tools.advisor") : t("tools.advisorDone")}</span>
    </li>
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
  const waiting = m.status === "streaming" && !m.text && !m.chips.length && !m.advising;
  return (
    <article className="max-w-full" aria-busy={m.status === "streaming"}>
      <AnswerTag m={m} />
      {m.chips.length || m.advising ? (
        <ul className="mb-1.5 flex flex-wrap gap-1.5" aria-label={t("thinking")}>
          {m.chips.map((c) => <Chip key={c.id} chip={c} />)}
          <AdvisorChip status={m.advising} />
        </ul>
      ) : null}
      {waiting ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />{t("thinking")}</p>
      ) : null}
      {m.text ? <AnswerMarkdown text={m.text} onNavigate={onNavigate} /> : null}
      {m.drafts.map((d) => <DraftCardView key={d.id} card={d} />)}
      {m.status === "error" && m.error ? (
        <div role="alert" className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
          <p className="font-medium">{m.error.code === "AI_BUDGET_EXCEEDED" ? t("budget.exhaustedTitle") : t("errorTitle")}</p>
          <p className="mt-0.5">{m.error.code === "AI_BUDGET_EXCEEDED" ? t("budget.exhaustedBody") : m.error.message}</p>
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
      <div className="grid h-11 w-11 place-items-center rounded-full bg-foreground text-background"><WsMark className="h-6 w-6" /></div>
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
