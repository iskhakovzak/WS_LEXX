/**
 * The assistant's answer as safe markdown (lib/markdown-parse: no raw HTML, link targets limited to http(s), mailto,
 * same-origin paths). Site paths become in-app links (wouter) so «где посмотреть X» opens the screen without a
 * reload; tables scroll sideways inside the panel. Re-parsed as the text streams in (answers are short).
 */
import * as React from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { parseMarkdown, type Align, type Block, type Inline } from "@/lib/markdown-parse";

function Inlines({ nodes, onNavigate }: { nodes: Inline[]; onNavigate?: () => void }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case "text": return <React.Fragment key={i}>{n.v}</React.Fragment>;
          case "br": return <br key={i} />;
          case "code": return <code key={i} className="rounded bg-[var(--glass-bg)] px-1 py-0.5 font-mono text-[0.85em] text-foreground">{n.v}</code>;
          case "strong": return <strong key={i} className="font-semibold text-foreground"><Inlines nodes={n.c} onNavigate={onNavigate} /></strong>;
          case "em": return <em key={i}><Inlines nodes={n.c} onNavigate={onNavigate} /></em>;
          case "link": {
            const cls = "text-primary underline underline-offset-4 decoration-primary/40 hover:decoration-primary";
            if (n.href.startsWith("/")) return <Link key={i} href={n.href} className={cls} onClick={onNavigate}><Inlines nodes={n.c} /></Link>;
            return <a key={i} href={n.href} className={cls} target="_blank" rel="noopener noreferrer nofollow"><Inlines nodes={n.c} /></a>;
          }
        }
      })}
    </>
  );
}

const alignCls = (a: Align) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");

function BlockView({ b, onNavigate }: { b: Block; onNavigate?: () => void }) {
  switch (b.t) {
    case "h":
      return <p className={cn("mt-3 font-semibold text-foreground first:mt-0", b.level <= 2 ? "text-[0.95rem]" : "text-sm")}><Inlines nodes={b.c} onNavigate={onNavigate} /></p>;
    case "p":
      return <p className="mt-2 leading-relaxed first:mt-0"><Inlines nodes={b.c} onNavigate={onNavigate} /></p>;
    case "hr":
      return <hr className="my-3 border-[var(--glass-border)]" />;
    case "code":
      return <pre className="mt-2 overflow-x-auto rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2.5 font-mono text-xs leading-relaxed"><code>{b.v}</code></pre>;
    case "quote":
      return <blockquote className="mt-2 border-l-2 border-primary/60 pl-3 text-foreground/90">{b.c.map((x, i) => <BlockView key={i} b={x} onNavigate={onNavigate} />)}</blockquote>;
    case "list": {
      const items = b.items.map((it, i) => <li key={i} className="pl-0.5 leading-relaxed"><Inlines nodes={it} onNavigate={onNavigate} /></li>);
      return b.ordered
        ? <ol start={b.start} className="mt-2 list-decimal space-y-1 pl-5 marker:text-muted-foreground marker:tabular-nums">{items}</ol>
        : <ul className="mt-2 list-disc space-y-1 pl-5 marker:text-muted-foreground">{items}</ul>;
    }
    case "table":
      return (
        <div className="mt-2 overflow-x-auto rounded-lg border border-[var(--glass-border)]">
          <table className="w-full border-collapse text-xs tabular-nums">
            <thead>
              <tr>
                {b.head.map((h, i) => (
                  <th key={i} scope="col" className={cn("whitespace-nowrap border-b border-[var(--glass-border)] bg-[var(--glass-bg)] px-2.5 py-1.5 font-medium text-muted-foreground", alignCls(b.align[i] ?? null))}>
                    <Inlines nodes={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri} className="border-b border-border/50 last:border-0">
                  {r.map((c, ci) => <td key={ci} className={cn("px-2.5 py-1.5", alignCls(b.align[ci] ?? null))}><Inlines nodes={c} onNavigate={onNavigate} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function AnswerMarkdown({ text, onNavigate, className }: { text: string; onNavigate?: () => void; className?: string }) {
  const blocks = React.useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className={cn("text-sm text-foreground/90 [overflow-wrap:anywhere]", className)}>
      {blocks.map((b, i) => <BlockView key={i} b={b} onNavigate={onNavigate} />)}
    </div>
  );
}
