import type { Metadata } from "next";
import { Steps } from "../../_components/steps";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Your profile" };

/** A1 step 3: the "Here's what we learned about you" card. */
export default function ProfilePage() {
  return (
    <>
      <Steps current={3} />
      <ProfileForm />
    </>
  );
}
