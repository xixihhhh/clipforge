import type { ReactNode } from "react";
import { requireProjectPageAccess } from "@/lib/saas/authorization";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireProjectPageAccess(id);
  return children;
}
