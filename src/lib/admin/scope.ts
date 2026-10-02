import { cache } from "react";
import { cookies } from "next/headers";
import { getCollections } from "@/lib/db/client";
import { assertWorkshopExists } from "@/lib/domain/workshops";
import type { WorkshopScope } from "@/lib/domain/queries";

/** Cookie holding the workshop picked in the top bar (read by server pages for their first render). */
export const SCOPE_COOKIE = "labs-admin-workshop";

/** Route handlers: `?workshopId=` (absent or empty = every workshop; unknown = 404, Business Rule 8). */
export async function requestScope(request: Request): Promise<WorkshopScope> {
  const id = new URL(request.url).searchParams.get("workshopId")?.trim();
  if (!id) return null;
  await assertWorkshopExists(id);
  return id;
}

/** Server components: the remembered workshop, or null when none is stored or it no longer exists. */
export const pageScope = cache(async (): Promise<WorkshopScope> => {
  const id = (await cookies()).get(SCOPE_COOKIE)?.value?.trim();
  if (!id) return null;
  const { workshops } = await getCollections();
  return (await workshops.countDocuments({ _id: id }, { limit: 1 })) ? id : null;
});
