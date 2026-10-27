"use client"

import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import { commonI18n } from "@/i18n/ns/common"

const Sheet = SheetPrimitive.Root

const SheetTrigger = SheetPrimitive.Trigger

const SheetClose = SheetPrimitive.Close

const SheetPortal = SheetPrimitive.Portal

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-sheet bg-[var(--overlay)] duration-[var(--dur-4)] data-[state=closed]:duration-[var(--dur-3)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
    ref={ref}
  />
))
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName

const sheetVariants = cva(
  "glass-thick glass-solid fixed z-sheet gap-4 overflow-y-auto overscroll-contain bg-popover p-6 text-popover-foreground ease-smooth data-[state=closed]:duration-[var(--dur-3)] data-[state=open]:duration-[var(--dur-4)] data-[state=open]:animate-in data-[state=closed]:animate-out",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 max-h-[92dvh] pt-[max(1.5rem,env(safe-area-inset-top))] border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 max-h-[92dvh] pb-[max(1.5rem,env(safe-area-inset-bottom))] border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-[88%] pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-md",
        right:
          "inset-y-0 right-0 h-full w-[88%] pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-md",
      },
      // Width presets for side sheets (sizing only — the motion classes above are untouched). Phones: full width.
      // Every preset is an inline-size container (`@container/sheet`), so the body reflows with the sheet, not the window.
      size: {
        default: "",
        md: "",
        lg: "",
        xl: "",
      },
    },
    compoundVariants: [
      { side: ["left", "right"], size: "md", className: "@container/sheet w-full sm:max-w-[30rem]" },
      { side: ["left", "right"], size: "lg", className: "@container/sheet w-full sm:max-w-[min(72rem,max(42rem,70vw))]" },
      { side: ["left", "right"], size: "xl", className: "@container/sheet w-full sm:max-w-[min(90rem,max(48rem,82vw))]" },
    ],
    defaultVariants: {
      side: "right",
      size: "default",
    },
  }
)

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = "right", size = "default", className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <SheetPrimitive.Content
      ref={ref}
      className={cn(sheetVariants({ side, size }), className)}
      {...props}
    >
      <SheetPrimitive.Close className="chip absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-sticky inline-flex h-8 w-8 items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none pointer-coarse:right-3 pointer-coarse:h-10 pointer-coarse:w-10">
        <X className="h-4 w-4" />
        <span className="sr-only">{commonI18n.t("actions.close")}</span>
      </SheetPrimitive.Close>
      {children}
    </SheetPrimitive.Content>
  </SheetPortal>
))
SheetContent.displayName = SheetPrimitive.Content.displayName

const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "overlay-bar overlay-bar-top flex flex-col gap-1.5 pr-10 text-left",
      className
    )}
    {...props}
  />
)
SheetHeader.displayName = "SheetHeader"

const SheetFooter = ({
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
SheetFooter.displayName = "SheetFooter"

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-tight tracking-tight text-foreground", className)}
    {...props}
  />
))
SheetTitle.displayName = SheetPrimitive.Title.displayName

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
SheetDescription.displayName = SheetPrimitive.Description.displayName

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
