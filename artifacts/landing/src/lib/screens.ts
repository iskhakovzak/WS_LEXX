// Which product screenshots exist in public/screens/ (README.md "Screenshots"). Build time only.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SCREENS, type ScreenId } from "../site.config";

const publicDir = new URL("../../public/", import.meta.url);
const has = (path: string) => existsSync(fileURLToPath(new URL(path.replace(/^\//, ""), publicDir)));

export type Screen = {
  id: ScreenId;
  hero: boolean;
  inside: boolean;
  exists: boolean;
  /** 1600x1000, the default src. */
  src: string;
  /** "<800w file> 800w, <1600w file> 1600w" when the small file exists, else just the large one. */
  srcset: string;
};

export const screens: Screen[] = SCREENS.map((s) => {
  const src = `/screens/${s.name}.webp`;
  const small = `/screens/${s.name}-800.webp`;
  return {
    id: s.id,
    hero: s.hero,
    inside: s.inside,
    exists: has(src),
    src,
    srcset: has(small) ? `${small} 800w, ${src} 1600w` : `${src} 1600w`,
  };
});

export const screenById = (id?: ScreenId): Screen | undefined => screens.find((s) => s.id === id && s.exists);
