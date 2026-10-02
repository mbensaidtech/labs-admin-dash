import { guardPage } from "@/lib/admin/page";
import { pageScope } from "@/lib/admin/scope";
import { getMatrix } from "@/lib/domain/queries";
import { MatrixView } from "./MatrixView";

export default async function MatrixPage() {
  const missing = await guardPage("/matrix");
  if (missing.length > 0) return null;
  return <MatrixView initial={await getMatrix(await pageScope())} />;
}
