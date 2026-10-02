import { guardPage } from "@/lib/admin/page";
import { listHelpRequests } from "@/lib/domain/queries";
import { HelpView } from "./HelpView";

export default async function HelpPage() {
  const missing = await guardPage("/help");
  if (missing.length > 0) return null;
  const [active, history] = await Promise.all([listHelpRequests(["open", "acknowledged"]), listHelpRequests(["resolved", "cancelled"])]);
  return <HelpView initialActive={active} initialHistory={history} />;
}
