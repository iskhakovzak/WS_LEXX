/**
 * /people/:id — a member's profile by users.id. The server decides access (own, or team.read on that person: staff on
 * the desk, a curator under «assigned» scope on wards); a trader opening another trader gets the closed view.
 */
import { useParams } from "wouter";
import { ProfileView } from "@/components/profile/profile-view";
import { parsePersonId } from "@/components/profile/model";

export default function PeoplePage() {
  const params = useParams<{ id?: string }>();
  const id = parsePersonId(params.id);
  // A malformed id is asked for anyway: the server answers 400 / 404 and the view shows «не найден».
  return <ProfileView profileRef={id ?? 0} />;
}
