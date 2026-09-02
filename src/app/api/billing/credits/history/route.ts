import { NextRequest, NextResponse } from "next/server";
import { requireApiIdentity } from "@/lib/saas/authorization";
import { getCreditHistory } from "@/lib/saas/billing";
import { isSaasMode } from "@/lib/saas/runtime";

export async function GET(req: NextRequest) {
  if (!isSaasMode()) return NextResponse.json({ error: "Not Found" }, { status: 404 });
  const access = await requireApiIdentity();
  if (!access.ok) return access.response;
  const requestedLimit = Number(req.nextUrl.searchParams.get("limit") ?? 50);
  const transactions = await getCreditHistory(
    access.identity!.user.id,
    Number.isFinite(requestedLimit) ? requestedLimit : 50,
  );
  return NextResponse.json({ transactions });
}
