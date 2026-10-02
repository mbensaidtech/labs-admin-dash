import { guardPage } from "@/lib/admin/page";
import { listWorkshops } from "@/lib/domain/workshops";
import { WorkshopsView } from "./WorkshopsView";

export default async function WorkshopsPage() {
  const missing = await guardPage("/workshops");
  if (missing.length > 0) return null;
  return <WorkshopsView initial={await listWorkshops()} />;
}
