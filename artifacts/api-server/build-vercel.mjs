/**
 * Vercel build (Build Output API v3): bundles src/serverless.ts into one Node function and routes every path to it.
 * The function has no node_modules, so the packages the API imports that build.mjs keeps external are bundled here.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { bundleServer } from "./build.mjs";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(artifactDir, ".vercel/output");
const funcDir = path.resolve(outputDir, "functions/index.func");

async function buildVercel() {
  await rm(outputDir, { recursive: true, force: true });
  await bundleServer({ entry: "src/serverless.ts", distDir: funcDir, bundleAlso: ["@google-cloud/*"] });
  await writeFile(
    path.join(funcDir, ".vc-config.json"),
    JSON.stringify({ runtime: "nodejs24.x", handler: "serverless.mjs", launcherType: "Nodejs", shouldAddHelpers: false, supportsResponseStreaming: true, maxDuration: 60 }, null, 2),
  );
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "config.json"), JSON.stringify({ version: 3, routes: [{ src: "/(.*)", dest: "/index" }] }, null, 2));
}

buildVercel().catch((err) => {
  console.error(err);
  process.exit(1);
});
