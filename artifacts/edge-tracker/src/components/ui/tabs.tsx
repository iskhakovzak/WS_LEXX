import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"
import { ActivePill } from "./active-pill"

const Tabs = TabsPrimitive.Root

/** One pill per list: its triggers share this id as the pill's layoutId, so the pill slides between them. */
const TabsGroup = React.createContext("tabs")

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => {
  const id = React.useId()
  return (
    <TabsGroup.Provider value={`tabs-pill-${id}`}>
      <TabsPrimitive.List
        ref={ref}
        className={cn(
          "glass-field inline-flex h-9 items-center justify-center gap-0.5 rounded-full p-[3px] text-muted-foreground",
          className
        )}
        {...props}
      />
    </TabsGroup.Provider>
  )
})
TabsList.displayName = TabsPrimitive.List.displayName

/** Radix keeps the active state on the element (data-state): mirror it so the trigger can render the pill. */
function useActiveState(el: React.RefObject<HTMLElement | null>): boolean {
  const [active, setActive] = React.useState(false)
  React.useLayoutEffect(() => {
    const node = el.current
    if (!node) return
    const sync = () => setActive(node.getAttribute("data-state") === "active")
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(node, { attributes: true, attributeFilter: ["data-state"] })
    return () => mo.disconnect()
  }, [el])
  return active
}

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, children, ...props }, ref) => {
  const group = React.useContext(TabsGroup)
  const own = React.useRef<HTMLButtonElement | null>(null)
  const active = useActiveState(own)
  const setRef = React.useCallback((node: HTMLButtonElement | null) => {
    own.current = node
    if (typeof ref === "function") ref(node)
    else if (ref) ref.current = node
  }, [ref])
  return (
    <TabsPrimitive.Trigger
      ref={setRef}
      className={cn(
        "relative inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm font-medium ring-offset-background transition-[background-color,color,box-shadow] duration-[var(--dur-1)] [&_svg]:size-4 [&_svg]:shrink-0 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-primary-foreground",
        className
      )}
      {...props}
    >
      {active && <ActivePill layoutId={group} />}
      <span className="relative inline-flex items-center gap-1.5">{children}</span>
    </TabsPrimitive.Trigger>
  )
})
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-[var(--dur-2)]",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
