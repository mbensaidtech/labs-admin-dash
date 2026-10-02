import { notFound } from "next/navigation";
import { ApiError } from "@/lib/api/errors";
import { guardPage } from "@/lib/admin/page";
import { getDevDetail, type DevDetailDto } from "@/lib/domain/queries";
import { DevDetailView } from "./DevDetailView";

async function loadDetail(userId: string): Promise<DevDetailDto | null> {
  try {
    return await getDevDetail(userId);
  } catch (error) {
    if (error instanceof ApiError && error.code === "notFound") return null;
    throw error;
  }
}

export default async function DevPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const missing = await guardPage(`/devs/${userId}`);
  if (missing.length > 0) return null;
  const initial = await loadDetail(userId);
  if (!initial) notFound();
  return <DevDetailView id={userId} initial={initial} />;
}
