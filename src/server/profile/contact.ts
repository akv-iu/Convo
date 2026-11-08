/** The signed-in user's private contact details (GET/PUT /api/me/contact). Never part of Person. */
import { eq } from "drizzle-orm";
import { db } from "../../../db";
import { users } from "../../../db/schema";
import { ContactDetails } from "@/contracts/types";

class ContactError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

type ContactColumns = { contactEmail: string | null; contactPhone: string | null; contactShare: string | null };

export function contactFromRow(row: ContactColumns): ContactDetails {
  const parsed = ContactDetails.safeParse({ email: row.contactEmail, phone: row.contactPhone, share: row.contactShare ?? "email" });
  return parsed.success ? parsed.data : { email: null, phone: null, share: "email" };
}

export async function getContact(userId: string): Promise<ContactDetails> {
  let row: ContactColumns | undefined;
  try {
    [row] = await db().select({ contactEmail: users.contactEmail, contactPhone: users.contactPhone, contactShare: users.contactShare })
      .from(users).where(eq(users.id, userId)).limit(1);
  } catch {
    throw new ContactError("Profile storage is unavailable. Try again.", 503);
  }
  if (!row) throw new ContactError("Profile not found.", 404);
  return contactFromRow(row);
}

export async function saveContact(userId: string, details: ContactDetails): Promise<ContactDetails> {
  let row: ContactColumns | undefined;
  try {
    [row] = await db().update(users)
      .set({ contactEmail: details.email, contactPhone: details.phone, contactShare: details.share })
      .where(eq(users.id, userId))
      .returning({ contactEmail: users.contactEmail, contactPhone: users.contactPhone, contactShare: users.contactShare });
  } catch {
    throw new ContactError("Profile storage is unavailable. Nothing was saved.", 503);
  }
  if (!row) throw new ContactError("Profile not found.", 404);
  return contactFromRow(row);
}
