/**
 * Landing lead form (artifacts/landing, POST /api/leads). One schema for the route and its tests. Segments and
 * team sizes are codes; the landing shows them in the visitor's language.
 */
import { z } from "zod";

export const LEAD_SEGMENTS = ["prop_desk", "funded_trader", "futures_firm"] as const;
export const LEAD_TEAM_SIZES = ["1", "2-10", "11-25", "26-50", "51-100", "100+"] as const;
export const LEAD_LOCALES = ["en", "es"] as const;

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalText = (max: number) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

export const LeadBody = z.object({
  segment: z.enum(LEAD_SEGMENTS),
  name: z.string().trim().min(1).max(120),
  company: optionalText(160),
  tradersCount: z.preprocess(blankToUndefined, z.enum(LEAD_TEAM_SIZES).optional()),
  platform: optionalText(80),
  email: z.string().trim().toLowerCase().max(254).email(),
  locale: z.enum(LEAD_LOCALES).default("en"),
  message: optionalText(2000),
  /** Landing path the form was sent from (no query string). */
  page: optionalText(300),
  /** Honeypot: a hidden field people never fill. A filled one is answered 201 and dropped. */
  website: z.string().max(200).optional(),
}).strict();

export type Lead = Omit<z.output<typeof LeadBody>, "website">;
