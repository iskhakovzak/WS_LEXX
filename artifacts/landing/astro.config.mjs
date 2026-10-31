// Static marketing landing for WS_DeskOS (README.md). English at /, Spanish at /es/.
import { defineConfig } from "astro/config";

export default defineConfig({
  // Absolute URLs (canonical, hreflang, sitemap later). Set LANDING_SITE_URL when the domain exists.
  site: process.env.LANDING_SITE_URL || "https://example.invalid",
  output: "static",
  trailingSlash: "ignore",
  build: { format: "directory", inlineStylesheets: "always" },
  i18n: {
    defaultLocale: "en",
    locales: ["en", "es"],
    routing: { prefixDefaultLocale: false },
  },
  compressHTML: true,
  devToolbar: { enabled: false },
  telemetry: false,
});
