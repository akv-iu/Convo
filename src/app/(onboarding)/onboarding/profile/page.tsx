import type { Metadata } from "next";
import { Steps } from "../../_components/steps";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Your details" };

/** Step 4: "Are these the correct details?" */
export default function ProfilePage() {
  return (
    <>
      <Steps current={4} />
      <ProfileForm />
    </>
  );
}
