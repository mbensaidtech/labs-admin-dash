import { guardPage } from "@/lib/admin/page";
import { pageScope } from "@/lib/admin/scope";
import { listHelpRequests } from "@/lib/domain/queries";
import { HelpView } from "./HelpView";

export default async function HelpPage() {
  const missing = await guardPage("/help");
  if (missing.length > 0) return null;
  const scope = await pageScope();
  const [active, history] = await Promise.all([listHelpRequests(["open", "acknowledged"], { scope }), listHelpRequests(["resolved", "cancelled"], { scope })]);
  return <HelpView initialScope={scope} initialActive={active} initialHistory={history} />;
}
