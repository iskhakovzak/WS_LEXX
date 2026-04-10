import React, { useState } from "react";
import {
  useListDiscussions, useCreateDiscussion, useDeleteDiscussion, useAddComment,
  getListDiscussionsQueryKey,
} from "@workspace/api-client-react";
import type { Discussion } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus, MessageSquare, Send, Tag, Pencil, X, Check } from "lucide-react";
import { TagSelector } from "@/components/tag-selector";
import { useAuth, WriteOnly } from "@/contexts/auth-context";
import { ScreenshotFields, ScreenshotDisplay, screenshotUrlsToString, stringToScreenshotUrls } from "@/components/screenshot-fields";

const TYPES = ["strategy", "analysis", "risk", "setup", "general"];
const COMMENT_STATUSES = [
  { value: "observing", label: "Observing" },
  { value: "in_position", label: "In Position" },
  { value: "exited", label: "Exited" },
];

function TagChips({ tags }: { tags?: string | null }) {
  if (!tags) return null;
  const chips = tags.split(",").map((t) => t.trim()).filter(Boolean);
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-0.5">
      {chips.map((tag, i) => (
        <span key={i} className="px-1.5 py-0 text-[9px] font-mono bg-primary/10 text-primary border border-primary/20 leading-4">{tag}</span>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  const map: Record<string, string> = {
    observing: "bg-blue-500/15 text-blue-400",
    in_position: "bg-emerald-500/15 text-emerald-400",
    exited: "bg-muted text-muted-foreground",
  };
  const labels: Record<string, string> = { observing: "Observing", in_position: "In Position", exited: "Exited" };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-mono ${map[status] ?? "bg-muted text-muted-foreground"}`}>
      {labels[status] ?? status}
    </span>
  );
}

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

type DiscFormData = { topic: string; type: string; trader: string; notes: string; tags: string; screenshotUrls: string[]; };
const blankDisc = (): DiscFormData => ({ topic: "", type: "general", trader: "", notes: "", tags: "", screenshotUrls: [""] });

export default function Discussions() {
  const qc = useQueryClient();
  const { user, dbUsers } = useAuth();
  const traderNames = dbUsers.filter((u) => u.active).map((u) => u.name);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<Discussion | null>(null);
  const [form, setForm] = useState<DiscFormData>(blankDisc());
  const [commentText, setCommentText] = useState<Record<number, string>>({});
  const [commentStatus, setCommentStatus] = useState<string>("observing");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [editingComment, setEditingComment] = useState<{ id: number; discussionId: number; text: string } | null>(null);
  const [deletingComment, setDeletingComment] = useState<{ id: number; discussionId: number } | null>(null);

  const traderName = user?.role === "trader" ? user.traderName : "Guest";

  const { data: discussions = [], isLoading } = useListDiscussions();
  const createMut = useCreateDiscussion({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListDiscussionsQueryKey() }); setOpen(false); setForm(blankDisc()); } } });
  const deleteMut = useDeleteDiscussion({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListDiscussionsQueryKey() }); setDeleting(null); } } });
  const commentMut = useAddComment({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListDiscussionsQueryKey() }); } } });

  function set(k: keyof DiscFormData, v: any) { setForm((f) => ({ ...f, [k]: v })); }

  function handleCreate() {
    if (!form.topic) return;
    const screenshotUrl = screenshotUrlsToString(form.screenshotUrls) || null;
    createMut.mutate({ data: { topic: form.topic, type: form.type || null, trader: form.trader || null, notes: form.notes || null, tags: form.tags || null, screenshotUrl } });
  }

  function handleComment(discussionId: number) {
    const text = commentText[discussionId]?.trim();
    if (!text) return;
    const fullText = `[${COMMENT_STATUSES.find((s) => s.value === commentStatus)?.label ?? commentStatus}] ${text}`;
    commentMut.mutate({ id: discussionId, data: { text: fullText, trader: traderName || null } });
    setCommentText((prev) => ({ ...prev, [discussionId]: "" }));
  }

  async function handleEditComment() {
    if (!editingComment) return;
    try {
      await fetch(`${BASE}/api/discussions/${editingComment.discussionId}/comments/${editingComment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: editingComment.text, trader: traderName }),
      });
      qc.invalidateQueries({ queryKey: getListDiscussionsQueryKey() });
    } catch (e) {}
    setEditingComment(null);
  }

  async function handleDeleteComment() {
    if (!deletingComment) return;
    try {
      await fetch(`${BASE}/api/discussions/${deletingComment.discussionId}/comments/${deletingComment.id}?trader=${encodeURIComponent(traderName)}`, {
        method: "DELETE",
      });
      qc.invalidateQueries({ queryKey: getListDiscussionsQueryKey() });
    } catch (e) {}
    setDeletingComment(null);
  }

  function openCreate() {
    const f = blankDisc();
    if (user?.traderName) f.trader = user.traderName;
    setForm(f);
    setOpen(true);
  }

  function parseCommentStatus(text: string): { status: string | null; body: string } {
    const match = text.match(/^\[(Observing|In Position|Exited)\]\s*(.*)/s);
    if (match) {
      const statusMap: Record<string, string> = { "Observing": "observing", "In Position": "in_position", "Exited": "exited" };
      return { status: statusMap[match[1]] ?? null, body: match[2] };
    }
    return { status: null, body: text };
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-foreground font-mono uppercase tracking-tight">Discussions</h1>
        <WriteOnly>
          <Button onClick={openCreate} className="font-mono uppercase tracking-tight text-xs gap-1">
            <Plus className="h-3 w-3" /> New Discussion
          </Button>
        </WriteOnly>
      </div>

      <div className="flex items-center gap-4 text-xs font-mono flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground uppercase">Commenting as:</span>
          <span className="text-primary font-bold">{traderName}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground uppercase">Status:</span>
          <Select value={commentStatus} onValueChange={setCommentStatus}>
            <SelectTrigger className="w-36 h-7 bg-card border-border text-xs font-mono"><SelectValue /></SelectTrigger>
            <SelectContent>
              {COMMENT_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value} className="text-xs font-mono">{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-3">
        {discussions.map((d) => (
          <div key={d.id} className={`bg-card border border-border font-mono text-xs border-l-[3px] ${
            d.type === "strategy" ? "border-l-emerald-500/40" :
            d.type === "risk" ? "border-l-red-500/40" :
            d.type === "analysis" ? "border-l-cyan-500/40" :
            d.type === "setup" ? "border-l-amber-500/40" :
            "border-l-primary/30"
          }`}>
            <div className="flex items-start justify-between px-4 py-3 border-b border-border cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => setExpanded(expanded === d.id ? null : d.id)}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {d.type && <span className={`text-[10px] px-1.5 py-0.5 uppercase font-bold border ${
                    d.type === "strategy" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
                    d.type === "risk" ? "bg-red-500/15 text-red-400 border-red-500/30" :
                    d.type === "analysis" ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/30" :
                    d.type === "setup" ? "bg-amber-500/15 text-amber-400 border-amber-500/30" :
                    "bg-primary/10 text-primary border-primary/20"
                  }`}>{d.type}</span>}
                  {d.trader && <span className="text-muted-foreground">{d.trader}</span>}
                  <span className="text-muted-foreground">{d.createdAt.substring(0, 10)}</span>
                </div>
                <div className="font-bold text-foreground text-sm truncate">{d.topic}</div>
                {d.notes && <div className="text-muted-foreground mt-1 truncate">{d.notes}</div>}
                <TagChips tags={(d as any).tags} />
              </div>
              <div className="flex items-center gap-3 ml-3 shrink-0">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span>{d.comments?.length ?? 0}</span>
                </div>
                <WriteOnly>
                  <button onClick={(e) => { e.stopPropagation(); setDeleting(d); }} className="p-1 text-muted-foreground hover:text-red-400 transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </WriteOnly>
              </div>
            </div>

            {expanded === d.id && (
              <div className="p-4 space-y-3">
                {(d as any).screenshotUrl && (
                  <ScreenshotDisplay urls={(d as any).screenshotUrl} />
                )}

                {(d.comments ?? []).length > 0 && (
                  <div className="space-y-2">
                    {(d.comments ?? []).map((c) => {
                      const parsed = parseCommentStatus(c.text);
                      const isOwn = c.trader === traderName;
                      const isEditing = editingComment?.id === c.id;
                      return (
                        <div key={c.id} className="flex gap-3 py-2 border-b border-border/50 last:border-0">
                          <div className="w-1 bg-primary/30 shrink-0 self-stretch" />
                          <div className="flex-1 min-w-0">
                            <div className="flex gap-2 items-center mb-0.5">
                              {c.trader && <span className="text-primary font-bold">{c.trader}</span>}
                              <StatusBadge status={parsed.status} />
                              <span className="text-muted-foreground">{c.createdAt.substring(0, 10)}</span>
                              {isOwn && !isEditing && (
                                <div className="flex gap-1 ml-auto">
                                  <button onClick={() => setEditingComment({ id: c.id, discussionId: d.id, text: c.text })} className="p-0.5 text-muted-foreground hover:text-primary transition-colors" title="Edit">
                                    <Pencil className="h-3 w-3" />
                                  </button>
                                  <button onClick={() => setDeletingComment({ id: c.id, discussionId: d.id })} className="p-0.5 text-muted-foreground hover:text-red-400 transition-colors" title="Delete">
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>
                              )}
                            </div>
                            {isEditing ? (
                              <div className="flex gap-2 mt-1">
                                <Textarea
                                  value={editingComment.text}
                                  onChange={(e) => setEditingComment({ ...editingComment, text: e.target.value })}
                                  rows={2}
                                  className="font-mono bg-background text-xs resize-none flex-1"
                                  onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleEditComment(); } }}
                                />
                                <div className="flex flex-col gap-1">
                                  <button onClick={handleEditComment} className="p-1 text-emerald-400 hover:text-emerald-300 transition-colors" title="Save">
                                    <Check className="h-3.5 w-3.5" />
                                  </button>
                                  <button onClick={() => setEditingComment(null)} className="p-1 text-muted-foreground hover:text-foreground transition-colors" title="Cancel">
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="text-foreground">{parsed.body}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <WriteOnly>
                  <div className="flex gap-2 pt-1">
                    <Textarea
                      value={commentText[d.id] ?? ""}
                      onChange={(e) => setCommentText((prev) => ({ ...prev, [d.id]: e.target.value }))}
                      placeholder="Add a comment..."
                      rows={2}
                      className="font-mono bg-background text-xs resize-none flex-1"
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleComment(d.id); } }}
                    />
                    <Button size="sm" onClick={() => handleComment(d.id)} disabled={commentMut.isPending} className="self-end font-mono text-xs gap-1 shrink-0">
                      <Send className="h-3 w-3" /> Send
                    </Button>
                  </div>
                  <div className="text-muted-foreground text-xs">Ctrl+Enter to send</div>
                </WriteOnly>
              </div>
            )}
          </div>
        ))}
        {discussions.length === 0 && !isLoading && (
          <div className="py-12 text-center text-muted-foreground text-xs font-mono">No discussions yet. Create one!</div>
        )}
      </div>

      <Dialog open={open} onOpenChange={(v) => { if (!v) setOpen(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto bg-card border-border font-mono">
          <DialogHeader><DialogTitle className="uppercase text-sm tracking-tight">New Discussion</DialogTitle></DialogHeader>
          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Topic *</Label>
              <Input value={form.topic} onChange={(e) => set("topic", e.target.value)} placeholder="NVDA: when to take profits?" className="font-mono bg-background h-8 text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-muted-foreground uppercase text-xs">Type</Label>
                <Select value={form.type} onValueChange={(v) => set("type", v)}>
                  <SelectTrigger className="font-mono bg-background h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{TYPES.map((s) => <SelectItem key={s} value={s} className="text-xs font-mono">{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-muted-foreground uppercase text-xs">Trader</Label>
                <Select value={form.trader} onValueChange={(v) => set("trader", v)}>
                  <SelectTrigger className="font-mono bg-background h-8 text-xs"><SelectValue placeholder="-" /></SelectTrigger>
                  <SelectContent>{traderNames.map((t) => <SelectItem key={t} value={t} className="text-xs font-mono">{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Description</Label>
              <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} className="font-mono bg-background text-xs resize-none" />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs flex items-center gap-1.5"><Tag className="h-3 w-3" />Tags</Label>
              <TagSelector
                selectedTags={form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : []}
                onChange={(tags) => set("tags", tags.join(", "))}
              />
            </div>
            <ScreenshotFields
              urls={form.screenshotUrls}
              onChange={(urls) => set("screenshotUrls", urls)}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} className="font-mono uppercase text-xs">Cancel</Button>
            <Button onClick={handleCreate} disabled={createMut.isPending || !form.topic} className="font-mono uppercase text-xs">
              {createMut.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
        <AlertDialogContent className="bg-card border-border font-mono">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm uppercase">Delete discussion?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">{deleting?.topic}. All comments will be deleted too.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-xs uppercase">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && deleteMut.mutate({ id: deleting.id })} className="font-mono text-xs uppercase bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deletingComment} onOpenChange={(v) => { if (!v) setDeletingComment(null); }}>
        <AlertDialogContent className="bg-card border-border font-mono">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm uppercase">Delete comment?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">This comment will be permanently removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-xs uppercase">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteComment} className="font-mono text-xs uppercase bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
