import type { ReactNode } from "react";
import { TopBar } from "@/components/TopBar";
import { ConfigError } from "@/components/ConfigError";
import { missingAdminEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const missing = missingAdminEnv();
  if (missing.length > 0) {
    return <ConfigError missing={missing} />;
  }
  return (
    <>
      <TopBar />
      {children}
    </>
  );
}
