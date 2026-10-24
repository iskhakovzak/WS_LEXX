/**
 * The living end point's pulse ring: a compositor-only CSS animation (Tailwind `animate-ping`, slowed down) placed over
 * the canvas — no repaint loop. The engine shows it only when motion is allowed and the view is at rest.
 */
import type { ChartTheme } from "@/components/chart-engine/theme";

export interface PulsePoint { x: number; y: number; tone: "up" | "down" | "flat" }

export class Pulse {
  private el: HTMLSpanElement;
  private ring: HTMLSpanElement;
  private sig = "";

  constructor(host: HTMLElement, before: Element) {
    // The wrapper carries the position (transform), the inner ring the ping keyframes (which animate transform too).
    this.el = document.createElement("span");
    this.el.className = "pointer-events-none absolute left-0 top-0 size-4";
    this.el.style.display = "none";
    this.el.setAttribute("aria-hidden", "true");
    this.ring = document.createElement("span");
    this.ring.className = "absolute inset-0 rounded-full animate-ping";
    this.ring.style.animationDuration = "2.4s";
    this.el.appendChild(this.ring);
    host.insertBefore(this.el, before);
  }

  set(p: PulsePoint | null, th: ChartTheme) {
    const sig = p ? `${Math.round(p.x * 2)}:${Math.round(p.y * 2)}:${p.tone}:${th.dark}` : "";
    if (sig === this.sig) return;
    this.sig = sig;
    if (!p) { this.el.style.display = "none"; return; }
    this.el.style.display = "block";
    this.el.style.transform = `translate(${p.x - 8}px, ${p.y - 8}px)`;
    this.ring.style.background = p.tone === "up" ? th.up(0.55) : p.tone === "down" ? th.down(0.55) : th.muted(0.5);
  }

  destroy() {
    this.el.remove();
  }
}
