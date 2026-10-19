import * as React from "react";

/** Scroll element of the nearest DataTable (null outside of one). Read by ds/virtual's VirtualRows. */
export const ScrollContainerContext = React.createContext<React.RefObject<HTMLElement | null> | null>(null);
