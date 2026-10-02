import type { ReactNode } from "react";
import { TopBar } from "@/components/TopBar";
import { ConfigError } from "@/components/ConfigError";
import { pageScope } from "@/lib/admin/scope";
import { WorkshopScopeProvider } from "@/lib/admin/WorkshopScopeProvider";
import { missingAdminEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const missing = missingAdminEnv();
  if (missing.length > 0) {
    return <ConfigError missing={missing} />;
  }
  // Database down: start on "All workshops"; the pages report the outage themselves.
  const initialScope = await pageScope().catch(() => null);
  return (
    <WorkshopScopeProvider initialScope={initialScope}>
      <TopBar />
      {children}
    </WorkshopScopeProvider>
  );
}
