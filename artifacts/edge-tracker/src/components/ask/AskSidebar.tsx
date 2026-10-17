// «Спроси журнал» side column: pinned questions, recent questions, grouped examples.
import { History, Pin, Sparkles, X } from "lucide-react";
import { Panel } from "@/components/ds";
import { cn } from "@/lib/utils";
import { ASK_EXAMPLE_GROUPS } from "@/lib/ask/examples";
import type { AskMemory } from "./use-ask-memory";

function QuestionRow({ text, active, onAsk, onRemove, removeLabel }: { text: string; active: boolean; onAsk: () => void; onRemove?: () => void; removeLabel?: string }) {
  return (
    <li className="group flex items-center gap-1">
      <button
        type="button"
        onClick={onAsk}
        className={cn(
          "min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-sm transition-colors duration-[var(--dur-1)] hover:bg-[var(--glass-hover-bg)]",
          active ? "bg-primary/10 text-foreground" : "text-foreground/90",
        )}
        title={text}
        aria-current={active || undefined}
      >
        {text}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground opacity-0 transition-opacity duration-[var(--dur-1)] hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

export function AskSidebar({ memory, current, onAsk }: { memory: AskMemory; current: string; onAsk: (text: string) => void }) {
  const cur = current.trim().toLowerCase();
  const isCur = (t: string) => t.trim().toLowerCase() === cur;
  return (
    <div className="flex min-w-0 flex-col gap-[var(--page-gap)]">
      {memory.pinned.length > 0 && (
        <Panel title="Закреплённые" icon={Pin}>
          <ul className="-mx-1 flex flex-col">
            {memory.pinned.map((t) => (
              <QuestionRow key={t} text={t} active={isCur(t)} onAsk={() => onAsk(t)} onRemove={() => memory.togglePin(t)} removeLabel={`Открепить: ${t}`} />
            ))}
          </ul>
        </Panel>
      )}
      {memory.history.length > 0 && (
        <Panel
          title="Недавние"
          icon={History}
          actions={<button type="button" onClick={memory.clearHistory} className="text-xs text-muted-foreground hover:text-foreground">Очистить</button>}
        >
          <ul className="-mx-1 flex flex-col">
            {memory.history.slice(0, 10).map((t) => (
              <QuestionRow key={t} text={t} active={isCur(t)} onAsk={() => onAsk(t)} onRemove={() => memory.forget(t)} removeLabel={`Удалить из истории: ${t}`} />
            ))}
          </ul>
        </Panel>
      )}
      <Panel title="Примеры вопросов" icon={Sparkles} bodyClassName="flex flex-col gap-4">
        {ASK_EXAMPLE_GROUPS.map((g) => (
          <div key={g.title}>
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">{g.title}</h3>
            <ul className="-mx-1 flex flex-col">
              {g.items.map((t) => <QuestionRow key={t} text={t} active={isCur(t)} onAsk={() => onAsk(t)} />)}
            </ul>
          </div>
        ))}
      </Panel>
    </div>
  );
}
