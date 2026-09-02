import { NextResponse } from "next/server";
import { requireApiIdentity } from "@/lib/saas/authorization";
import { getBillingSummary } from "@/lib/saas/billing";
import { isSaasMode } from "@/lib/saas/runtime";

export async function GET() {
  if (!isSaasMode()) return NextResponse.json({ error: "Not Found" }, { status: 404 });
  const access = await requireApiIdentity();
  if (!access.ok) return access.response;
  const { balance } = await getBillingSummary(access.identity!.user.id);
  return NextResponse.json({ balance });
}
