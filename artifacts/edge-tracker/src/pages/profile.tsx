/**
 * /profile — the viewer's own profile: «Характеристика», «Автобиография», analytics, the trading card
 * (components/profile). Every member has one, staff included (staff are traders too).
 */
import { ProfileView } from "@/components/profile/profile-view";

export default function ProfilePage() {
  return <ProfileView profileRef="me" />;
}
