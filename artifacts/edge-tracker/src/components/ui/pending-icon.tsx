import { Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A button's icon that turns into a spinner while its server-confirmed write is in flight (risk, capital, PropReports,
 * admin actions, deletes): the press shows at once without guessing the result. Without `icon` the spinner only
 * appears while pending. Reduced motion keeps the spinner glyph still.
 */
export function PendingIcon({ pending, icon: Icon, className }: { pending: boolean; icon?: LucideIcon; className?: string }) {
  if (pending) return <Loader2 className={cn("animate-spin motion-reduce:animate-none", className)} aria-hidden="true" />;
  return Icon ? <Icon className={className} aria-hidden="true" /> : null;
}
