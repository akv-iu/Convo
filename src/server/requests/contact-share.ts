/**
 * Contact sharing: once a request is agreed (accepted, or a meeting booked), each side sees the
 * contact details the other chose to share. Before that, or if they chose nothing, nothing.
 */
import type { ContactDetails, RequestStatus, SharedContact } from "@/contracts/types";

export const NO_CONTACT: ContactDetails = { email: null, phone: null, share: "email" };

export function isAgreed(status: RequestStatus): boolean {
  return status === "accepted" || status === "scheduled";
}

/** The other person's details to show on an agreed request, or null. */
export function sharedContact(details: ContactDetails | undefined, status: RequestStatus): SharedContact | null {
  if (!details || !isAgreed(status)) return null;
  const email = details.share !== "phone" ? details.email : null;
  const phone = details.share !== "email" ? details.phone : null;
  return email || phone ? { email, phone } : null;
}
