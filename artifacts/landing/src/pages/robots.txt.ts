import type { APIRoute } from "astro";
import { NOINDEX } from "../site.config";

/** Follows the same build flag as the noindex meta tag (site.config.ts NOINDEX). */
export const GET: APIRoute = () =>
  new Response(NOINDEX ? "User-agent: *\nDisallow: /\n" : "User-agent: *\nAllow: /\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
