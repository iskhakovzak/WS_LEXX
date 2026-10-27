import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import { commonI18n } from "@/i18n/ns/common"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-modal bg-[var(--overlay)] duration-[var(--dur-3)] data-[state=closed]:duration-[var(--dur-2)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

/**
 * Width per size; className max-w-* still wins (tailwind-merge). sm — a short question / one field; md (default)
 * — a form; lg — a two-column form or a list; xl — a table, a preview with controls; full — almost the screen.
 */
const dialogSizes = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
  full: "max-w-[min(96vw,90rem)]",
} as const
export type DialogSize = keyof typeof dialogSizes

/**
 * The centred card on tablets / desktops: never taller than 90% of the viewport, the body scrolls inside while
 * DialogHeader / DialogFooter stay (.overlay-bar). Phones (< 640px): a bottom sheet over the full width, up to
 * the whole height, sliding up instead of zooming.
 */
export const overlayCardClass =
  "glass-thick glass-solid fixed left-[50%] top-[50%] z-modal grid grid-cols-[minmax(0,1fr)] max-h-[90dvh] w-[calc(100%-1.5rem)] translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto overscroll-contain rounded-2xl bg-popover p-6 text-popover-foreground duration-[var(--dur-3)] data-[state=closed]:duration-[var(--dur-2)] ease-smooth data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] " +
  "max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:w-full max-sm:max-w-none max-sm:max-h-[calc(100dvh-0.75rem)] max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-3xl max-sm:pb-[max(1.5rem,env(safe-area-inset-bottom))] max-sm:data-[state=open]:zoom-in-100 max-sm:data-[state=closed]:zoom-out-100 max-sm:data-[state=open]:slide-in-from-left-0 max-sm:data-[state=closed]:slide-out-to-left-0 max-sm:data-[state=open]:slide-in-from-bottom max-sm:data-[state=closed]:slide-out-to-bottom"

/** The X of a dialog / sheet: above the sticky header bar (.overlay-bar), so all of it stays clickable. */
export const overlayCloseClass =
  "chip absolute right-4 top-4 z-sticky inline-flex h-8 w-8 items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none pointer-coarse:right-3 pointer-coarse:top-3 pointer-coarse:h-10 pointer-coarse:w-10"

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { size?: DialogSize }
>(({ className, children, size = "md", ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(overlayCardClass, dialogSizes[size], className)}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className={overlayCloseClass}>
        <X className="h-4 w-4" />
        <span className="sr-only">{commonI18n.t("actions.close")}</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "overlay-bar overlay-bar-top flex flex-col gap-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "overlay-bar overlay-bar-bottom flex flex-col-reverse gap-inline sm:flex-row sm:flex-wrap sm:items-center sm:justify-end",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "pr-10 text-lg font-semibold leading-tight tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
