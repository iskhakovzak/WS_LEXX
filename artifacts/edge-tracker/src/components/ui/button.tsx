import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-[background-color,color,border-color,box-shadow,transform] duration-[var(--dur-1)] ease-smooth active:scale-[0.98] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 disabled:[&:not([title])]:pointer-events-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0" +
" hover-elevate active-elevate-2",
  {
    variants: {
      variant: {
        default:
           // @replit: no hover, and add primary border
           // Monochrome primary (2026-10-24): near-white with black text in dark, ink with white text in light. No glow;
           // hover steps the fill back a little (brightness would not move a white fill).
           "bg-primary-solid text-primary-foreground font-semibold border border-transparent shadow-[inset_0_1px_0_rgb(255_255_255/0.2)] hover:not-disabled:bg-primary-solid/88 active:scale-[0.97]",
        destructive:
          "border border-destructive/30 bg-destructive/12 text-destructive hover:not-disabled:bg-destructive/18",
        // Glass family: outline = hairline glass pill, secondary = thicker glass pill,
        // ghost = no chrome until hover, then the same glass surface + hairline.
        outline:
          "glass-field text-foreground",
        secondary:
          "glass-field text-foreground bg-[var(--glass-thick-bg)]",
        ghost: "border border-transparent hover:border-[var(--field-border)] hover:bg-[var(--glass-hover-bg)] hover:shadow-[inset_0_1px_0_var(--glass-hi)] data-[state=open]:bg-[var(--glass-hover-bg)]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // Control-height scale (index.css): sm 32 / md 36 / lg 40, border included. min-h (not h) so an
        // explicit multi-line button (`h-auto whitespace-normal`) can still grow; the padding never pushes a
        // single line past the token (default used to render 39px next to 36px inputs).
        default: "min-h-9 px-4 py-1.5",
        sm: "min-h-8 px-3 text-xs [&_svg]:size-3.5",
        lg: "min-h-10 px-6 py-2",
        // Touch screens: index.css grows every control's hit area to 44×44 px with an invisible ::before
        // (::after is taken by hover-elevate), so the look stays the same.
        icon: "h-9 w-9",
        "icon-sm": "h-8 w-8 [&_svg]:size-3.5",
      },
      // A long or dynamic label (a lesson title, a uz / ru phrase) wraps to two balanced lines inside its card
      // instead of being clipped or pushing the button out of it. The pill turns into a 18px-radius capsule.
      wrap: {
        true: "h-auto min-w-0 max-w-full whitespace-normal text-balance text-left leading-ui rounded-[1.125rem] py-1.5",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      wrap: false,
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, wrap, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        data-slot="button"
        className={cn(buttonVariants({ variant, size, wrap, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
