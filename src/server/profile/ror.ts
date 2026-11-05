import { z } from "zod";
import type { RorMatch } from "@/contracts/types";

const record = z.object({
  id: z.string().regex(/^https:\/\/ror\.org\/0[0-9a-hj-km-np-tv-z]{6}\d{2}$/),
  status: z.enum(["active", "inactive", "withdrawn"]),
  names: z.array(z.object({ value: z.string().trim().min(1), types: z.array(z.string()) }))
    .refine((names) => names.some(({ types }) => types.includes("ror_display"))),
  locations: z.array(z.object({ geonames_details: z.object({ country_code: z.string().regex(/^[A-Z]{2}$/) }) })).min(1),
});
const responseSchema = z.object({ items: z.array(record) });

class WorkplaceError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function searchWorkplaces(query: string): Promise<RorMatch[]> {
  const term = query.trim();
  if (!term) return [];
  if (term.length > 200) throw new WorkplaceError("Workplace search must be 200 characters or fewer.", 400);

  const url = new URL("https://api.ror.org/v2/organizations");
  // ROR uses Elasticsearch query syntax; treat punctuation in workplace names literally.
  url.searchParams.set("query", term.replace(/[+\-=!(){}\[\]^"~*?:\\/<>]|&&|\|\|/g, "\\$&"));
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" }, cache: "no-store",
      redirect: "error", signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("ROR request failed");
    const { items } = responseSchema.parse(await response.json());
    return items.filter(({ status }) => status === "active").slice(0, 8).map((item) => ({
      id: item.id,
      name: item.names.find(({ types }) => types.includes("ror_display"))!.value,
      // The shared contract has one country; keep the first ROR location's country.
      country: item.locations[0].geonames_details.country_code,
    }));
  } catch {
    throw new WorkplaceError("Workplace search is unavailable. Try again shortly.", 503);
  }
}
