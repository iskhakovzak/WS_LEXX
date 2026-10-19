import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
// Enforced script CSP <meta> in the built index.html (the full policy is a report-only header from the API).
import { cspMeta } from "./scripts/csp-meta.mjs";

const rawPort = process.env.PORT || "5000";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH || "/";

const VENDOR_CHUNKS: Record<string, readonly string[]> = {
  "vendor-react": ["react", "react-dom", "scheduler"],
  "vendor-query": ["@tanstack/query-core", "@tanstack/react-query"],
  "vendor-motion": ["framer-motion", "motion-dom", "motion-utils"],
};
const CHUNK_BY_PKG = new Map(Object.entries(VENDOR_CHUNKS).flatMap(([chunk, pkgs]) => pkgs.map((p) => [p, chunk] as const)));

/** Package name of a module id (the last `node_modules/<pkg>` in a pnpm path), or null for app code. */
function packageOf(id: string): string | null {
  const m = /[\\/]node_modules[\\/](@[^\\/]+[\\/][^\\/]+|[^\\/@][^\\/]*)[\\/](?!.*[\\/]node_modules[\\/])/.exec(id);
  return m ? m[1].replace(/\\/g, "/") : null;
}

function vendorChunkOf(id: string): string | undefined {
  const pkg = packageOf(id);
  if (!pkg) return undefined;
  return CHUNK_BY_PKG.get(pkg);
}

const onReplit = process.env.REPL_ID !== undefined;
const devHost = process.env.VITE_HOST || (onReplit ? "0.0.0.0" : "localhost");

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    cspMeta(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  // Several dev servers on one checkout (parallel agents) need separate dep caches; the vite CLI has no --cacheDir flag.
  ...(process.env.VITE_CACHE_DIR ? { cacheDir: process.env.VITE_CACHE_DIR } : {}),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // DEV-11: the entry chunk was 1 MB (323 kB gzip). Big, rarely-changing libraries go to their own chunks, so the
        // entry stays small and the vendor files stay cached across deploys. Only libraries the entry itself needs
        // (react, query, motion): a manual chunk also swallows its shared helpers (lodash, react-is …), so a «charts»
        // chunk made the entry preload recharts — chart libraries stay in Rollup's own lazy split.
        manualChunks: vendorChunkOf,
      },
    },
  },
  server: {
    port,
    // Replit's preview proxy needs every interface and any host; locally the dev server (which can read
    // .env files) stays on this machine. VITE_HOST overrides both.
    host: devHost,
    allowedHosts: onReplit ? true : undefined,
    proxy: {
      "/api": {
        // API_TARGET lets a second dev server (own port = own localStorage session) talk to another API instance.
        target: process.env.API_TARGET || "http://localhost:8080",
        changeOrigin: true,
      },
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: devHost,
    allowedHosts: onReplit ? true : undefined,
  },
});
