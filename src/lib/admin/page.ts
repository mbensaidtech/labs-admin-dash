import { redirect } from "next/navigation";
import { hasAdminSession } from "@/lib/admin/guard";
import { missingAdminEnv } from "@/lib/env";

/** Server components: configuration error names, or a redirect to /login without a session. */
export async function guardPage(next: string): Promise<string[]> {
  const missing = missingAdminEnv();
  if (missing.length > 0) return missing;
  if (!(await hasAdminSession())) {
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  return [];
}
