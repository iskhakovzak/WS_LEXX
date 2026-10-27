/**
 * /profile — the viewer's own profile: «Характеристика», «Автобиография», analytics, the trading card
 * (components/profile) and the achievements shelf (components/quests). Every member has one, staff included.
 */
import { ProfileView } from "@/components/profile/profile-view";
import { ProfileAchievements } from "@/components/quests/profile-shelf";

export default function ProfilePage() {
  return <ProfileView profileRef="me" achievements={(w) => <ProfileAchievements trader={w.name} self={w.self} />} />;
}
