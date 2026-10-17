/** "Идея" — creates a draft trade idea pre-filled from the setup (playbook → ideas cross-link). */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TradeIdeaForm, blankIdea, type TradeIdeaFormData } from "@/components/trade-idea-form";
import { screenshotUrlsToString } from "@/components/screenshot-fields";
import { useToast } from "@/hooks/use-toast";
import { http } from "@/lib/api/http";
import type { PlaybookEntry } from "./model";

export function CreateIdeaButton({ entry, compact }: { entry: PlaybookEntry; compact?: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const initial: Partial<TradeIdeaFormData> = {
    ...blankIdea(),
    playbookId: entry.id,
    setup: entry.name ?? "",
    side: /short|fade/i.test(entry.setupType ?? "") ? "Short" : "Long",
    ticker: entry.ticker ?? "",
    tags: entry.tags ?? "",
  };
  const createMut = useMutation({
    mutationFn: (data: TradeIdeaFormData) => {
      const { screenshotUrls, ...rest } = data;
      return http.post("/api/trade-ideas", { ...rest, screenshotUrl: screenshotUrlsToString(screenshotUrls) || null, score: data.score ? Number(data.score) : null, status: "draft" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trade-ideas"] });
      setOpen(false);
      toast({ title: "Черновик идеи создан", description: `Сетап «${entry.name}»` });
    },
    onError: (e: any) => toast({ title: "Не удалось создать идею", description: String(e?.message ?? e), variant: "destructive" }),
  });
  return (
    <>
      <Button variant="outline" size="sm" className="h-8" onClick={() => setOpen(true)} aria-label={compact ? "Создать идею по сетапу" : undefined}>
        <Lightbulb className="h-4 w-4" aria-hidden="true" />
        {!compact && <span>Идея</span>}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] w-full max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Идея по сетапу</DialogTitle>
            <DialogDescription>«{entry.name}» — сохранится как черновик в разделе «Идеи».</DialogDescription>
          </DialogHeader>
          <TradeIdeaForm initial={initial} onSubmit={(d) => createMut.mutate(d)} onCancel={() => setOpen(false)} submitting={createMut.isPending} />
        </DialogContent>
      </Dialog>
    </>
  );
}
