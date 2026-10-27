/**
 * «Разговор» with the mentor on /coach: the thread (the rhythm openers are part of it), three starter questions, a
 * composer. One request per turn (no streaming: answers are short). «Очистить» clears the conversation; the mentor's
 * memory lives in its notes and stays.
 */
import * as React from "react";
import { Eraser, Loader2, MessageCircle, Send } from "lucide-react";
import { Panel } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { fmtDeskTime } from "@/lib/format";
import { mentorI18n } from "@/i18n/ns/mentor";
import { useClearThread, useMentorChat, type Message } from "./api";

const STARTERS = ["a", "b", "c"] as const;

function Bubble({ m }: { m: Message }) {
  const { t } = mentorI18n.useT();
  const mine = m.role === "user";
  return (
    <li className={`flex flex-col gap-0.5 ${mine ? "items-end" : "items-start"}`}>
      <span className="text-2xs text-muted-foreground">{mine ? t("chat.you") : t("chat.mentor")} · {fmtDeskTime(m.createdAt)}</span>
      <div className={`max-w-[92%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${mine ? "bg-primary/10 text-foreground" : "tile text-foreground"}`}>{m.content}</div>
    </li>
  );
}

export function MentorChat({ thread, allowed }: { thread: Message[]; allowed: boolean }) {
  const { t } = mentorI18n.useT();
  const send = useMentorChat();
  const clear = useClearThread();
  const [text, setText] = React.useState("");
  const [pending, setPending] = React.useState<string | null>(null);
  const end = React.useRef<HTMLLIElement>(null);
  React.useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [thread.length, pending]);

  const submit = (message: string) => {
    const m = message.trim();
    if (!m || send.isPending) return;
    setPending(m);
    setText("");
    send.mutate(m, { onSettled: () => setPending(null), onError: () => setText(m) });
  };
  return (
    <Panel
      title={t("chat.title")}
      icon={MessageCircle}
      actions={thread.length ? <Button size="sm" variant="ghost" disabled={clear.isPending} onClick={() => clear.mutate(undefined)}><Eraser aria-hidden="true" />{t("chat.clear")}</Button> : null}
    >
      <div className="flex flex-col gap-3">
        {thread.length === 0 && !pending ? (
          <p className="text-sm text-muted-foreground">{t("chat.empty")}</p>
        ) : (
          <ul className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto pr-1" aria-live="polite">
            {thread.map((m) => <Bubble key={m.id} m={m} />)}
            {pending && <Bubble m={{ id: -1, role: "user", kind: "chat", content: pending, createdAt: new Date().toISOString() }} />}
            {send.isPending && <li className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t("chat.thinking")}</li>}
            <li ref={end} aria-hidden="true" />
          </ul>
        )}
        {send.isError && <p className="text-sm text-destructive" role="alert">{t("chat.failed")}</p>}
        {allowed && (
          <>
            {thread.length === 0 && (
              <div className="flex flex-wrap gap-1.5">
                {STARTERS.map((k) => (
                  <button key={k} type="button" onClick={() => submit(t(`chat.suggestions.${k}`))} className="min-h-8 rounded-full border border-border px-3 text-xs text-muted-foreground hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {t(`chat.suggestions.${k}`)}
                  </button>
                ))}
              </div>
            )}
            <form onSubmit={(e) => { e.preventDefault(); submit(text); }} className="flex items-end gap-2">
              <Textarea
                value={text}
                rows={2}
                maxLength={4000}
                placeholder={t("chat.placeholder")}
                aria-label={t("chat.placeholder")}
                className="min-w-0 flex-1 resize-none"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(text); } }}
              />
              <Button type="submit" disabled={!text.trim() || send.isPending} aria-label={t("chat.send")}><Send aria-hidden="true" /></Button>
            </form>
          </>
        )}
      </div>
    </Panel>
  );
}
