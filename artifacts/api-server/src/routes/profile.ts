/**
 * «Профиль» — one person's scouting card, biography and analytics (lib/profile/*). GET only, stored data only.
 *
 *   GET /profile/me      the viewer's own profile
 *   GET /profile/:id     a member by users.id
 *
 * Access (the personal-data contract, lib/auth personalTrader with `team.read`): the person themselves, or a member
 * whose team.read covers them — staff on the whole desk by default, a curator under «assigned» scope only on their wards.
 * A trader never opens another trader's profile (403 PERSONAL_DATA_FORBIDDEN); a missing id answers 404 only to a viewer
 * who may read the desk at all (others get the same 403 — no roster probing). Guests: never.
 * Extras: curator steps in the biography need journal.review on the person (never on one's own profile); the closest
 * peer by style is a staff tool (journal.review) and stays inside the viewer's team.read scope. Private notes, journal
 * texts and plans are not part of the profile at all.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { AppError, assertCap, idParam, notFound, route } from "../lib/http";
import { personalTrader } from "../lib/auth";
import { can, readScope } from "../lib/permissions";
import { personById, personByName } from "../lib/profile/load";
import { buildProfile, type ProfileViewer } from "../lib/profile/service";
import type { Request } from "express";

const router: IRouter = Router();

async function viewerFor(req: Request, person: string, self: boolean): Promise<ProfileViewer> {
  const staffTool = await can(req, "journal.review");
  return {
    self,
    curatorSteps: !self && (await can(req, "journal.review", { trader: person })),
    peerScope: staffTool ? await readScope(req, "team.read") : false,
  };
}

router.get("/profile/me", route({}, async ({ req }) => {
  const actor = await assertCap(req, "trades.read.own");
  const person = await personByName(actor.name);
  if (!person) throw notFound("USER_NOT_FOUND");
  return buildProfile(person, await viewerFor(req, person.name, true));
}));

router.get("/profile/:id", route({ params: z.object({ id: idParam }) }, async ({ req, params }) => {
  const person = await personById(params.id);
  if (!person) {
    // Only a viewer who may read the desk learns that the id does not exist.
    if (await can(req, "team.read")) throw notFound("USER_NOT_FOUND");
    throw new AppError("PERSONAL_DATA_FORBIDDEN");
  }
  const owner = await personalTrader(req, person.name, "team.read");
  const self = owner === req.authUser?.name;
  return buildProfile(person, await viewerFor(req, person.name, self));
}));

export default router;
