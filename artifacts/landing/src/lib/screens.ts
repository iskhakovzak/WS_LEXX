// Which product screenshots exist in public/screens/ (README.md "Screenshots"). Build time only.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SCREENS } from "../site.config";

const publicDir = new URL("../../public/", import.meta.url);

export const screens = SCREENS.map((s) => ({
  ...s,
  exists: existsSync(fileURLToPath(new URL(s.file.replace(/^\//, ""), publicDir))),
}));
