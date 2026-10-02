import { guardPage } from "@/lib/admin/page";
import { pageScope } from "@/lib/admin/scope";
import { getOverview } from "@/lib/domain/queries";
import { OverviewView } from "./OverviewView";

export default async function OverviewPage() {
  const missing = await guardPage("/");
  if (missing.length > 0) return null;
  const initial = await getOverview(await pageScope());
  return <OverviewView initial={initial} />;
}
