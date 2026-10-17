import * as React from "react";
import { Send, Shield, ThumbsUp, Trash2 } from "lucide-react";
import { Pill, type Tone } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { BASE } from "@/lib/api";
import { cn } from "@/lib/utils";

type Reaction = { id: number; tradeId: number; trader: string; reactionType: string };
type Review = { id: number; tradeId: number; curator: string; comment: string; rating?: string; createdAt: string };

const RATING: Record<string, { label: string; tone: Tone }> = {
  excellent: { label: "Отлично", tone: "up" },
  good: { label: "Хорошо", tone: "accent" },
  needs_work: { label: "Доработать", tone: "warn" },
  poor: { label: "Плохо", tone: "down" },
};

async function errorText(r: Response): Promise<string> {
  const body: { error?: string } = await r.json().catch(() => ({}));
  return body?.error ?? `Статус ${r.status}`;
}

/**
 * Likes + curator reviews for a trade (same endpoints as before the redesign). `showReviews={false}` (another
 * trader's trade opened from the playbook) keeps only the likes: reviews are owner / staff feedback (403 otherwise).
 */
export function TradeSocial({ tradeId, traderName, isCurator, onCount, showReviews = true }: {
  tradeId: number; traderName: string | null; isCurator: boolean; onCount?: (n: number) => void; showReviews?: boolean;
}) {
  const { toast } = useToast();
  const [reactions, setReactions] = React.useState<Reaction[]>([]);
  const [reviews, setReviews] = React.useState<Review[]>([]);
  const [reviewText, setReviewText] = React.useState("");
  const [reviewRating, setReviewRating] = React.useState("good");
  const [likePending, setLikePending] = React.useState(false);
  const [reviewPending, setReviewPending] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    const load = <T,>(path: string, set: (v: T[]) => void, title: string) =>
      fetch(`${BASE}/api/trades/${tradeId}/${path}`)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then((d) => { if (alive) set(Array.isArray(d) ? d : []); })
        .catch(() => { if (alive) toast({ title, variant: "destructive" }); });
    load<Reaction>("reactions", setReactions, "Ошибка загрузки реакций");
    if (showReviews) load<Review>("reviews", setReviews, "Ошибка загрузки отзывов");
    return () => { alive = false; };
  }, [tradeId, showReviews]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => { onCount?.(reviews.length); }, [reviews.length, onCount]);

  const hasLiked = reactions.some((r) => r.trader === traderName);

  async function toggleLike() {
    if (!traderName || likePending) return;
    setLikePending(true);
    try {
      const r = await fetch(`${BASE}/api/trades/${tradeId}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trader: traderName, reactionType: "like" }),
      });
      if (!r.ok) throw new Error(await errorText(r));
      const updated = await fetch(`${BASE}/api/trades/${tradeId}/reactions`).then((res) => res.json());
      if (Array.isArray(updated)) setReactions(updated);
    } catch (e) {
      toast({ title: "Не удалось поставить реакцию", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setLikePending(false);
    }
  }

  async function submitReview() {
    if (!reviewText.trim() || !traderName || reviewPending) return;
    setReviewPending(true);
    try {
      const r = await fetch(`${BASE}/api/trades/${tradeId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ curator: traderName, comment: reviewText, rating: reviewRating }),
      });
      if (!r.ok) throw new Error(await errorText(r));
      setReviewText("");
      const updated = await fetch(`${BASE}/api/trades/${tradeId}/reviews`).then((res) => res.json());
      if (Array.isArray(updated)) setReviews(updated);
      toast({ title: "Ревью отправлено" });
    } catch (e) {
      toast({ title: "Не удалось отправить ревью", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setReviewPending(false);
    }
  }

  async function deleteReview(reviewId: number) {
    if (!traderName || !window.confirm("Удалить это ревью?")) return;
    try {
      const r = await fetch(`${BASE}/api/trades/${tradeId}/reviews/${reviewId}?curator=${encodeURIComponent(traderName)}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await errorText(r));
      setReviews((prev) => prev.filter((rv) => rv.id !== reviewId));
      toast({ title: "Ревью удалено" });
    } catch (e) {
      toast({ title: "Не удалось удалить ревью", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={toggleLike}
          disabled={!traderName || likePending}
          aria-pressed={hasLiked}
          className="chip inline-flex min-h-8 items-center gap-1.5 px-3 text-sm font-medium disabled:opacity-50"
        >
          <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
          {hasLiked ? "Нравится" : "Отметить"}
          {reactions.length > 0 && <span className="tabular-nums opacity-80">{reactions.length}</span>}
        </button>
        {reactions.length > 0 && <span className="text-xs text-muted-foreground">{reactions.map((r) => r.trader).join(", ")}</span>}
      </div>

      {showReviews && (
        <div className="space-y-2">
          <p className="micro-label">Ревью кураторов</p>
          {reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">Пока нет ревью.</p>
          ) : (
            reviews.map((r) => (
              <div key={r.id} className="rounded-xl border border-border/70 bg-[var(--glass-bg)] p-3 shadow-[inset_3px_0_0_hsl(var(--chart-5))]">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 font-semibold text-[hsl(var(--chart-5))]"><Shield className="h-3 w-3" aria-hidden="true" />{r.curator}</span>
                  {r.rating && <Pill tone={RATING[r.rating]?.tone ?? "neutral"}>{RATING[r.rating]?.label ?? r.rating}</Pill>}
                  <span className="tabular-nums text-muted-foreground">{r.createdAt.substring(0, 10)}</span>
                  {r.curator === traderName && (
                    <button type="button" aria-label="Удалить ревью" onClick={() => deleteReview(r.id)} className="ml-auto grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-down">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-sm">{r.comment}</p>
              </div>
            ))
          )}
        </div>
      )}

      {isCurator && showReviews && (
        <div className="space-y-2 rounded-xl border border-border/70 p-3">
          <p className="text-sm font-semibold">Оставить ревью</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <div className="sm:w-40">
              <Label htmlFor={`rv-rating-${tradeId}`} className="sr-only">Оценка</Label>
              <Select value={reviewRating} onValueChange={setReviewRating}>
                <SelectTrigger id={`rv-rating-${tradeId}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(RATING).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Textarea
              aria-label="Комментарий куратора"
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              rows={2}
              placeholder="Что хорошо, что исправить… (Ctrl+Enter — отправить)"
              className={cn("flex-1 resize-y rounded-xl")}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitReview(); } }}
            />
          </div>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={submitReview} disabled={!reviewText.trim() || reviewPending} className="gap-1.5">
              <Send className="h-3.5 w-3.5" /> {reviewPending ? "Отправляем…" : "Отправить"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
