import { NextRequest, NextResponse } from "next/server";
import { requireApiIdentity } from "@/lib/saas/authorization";
import {
  CreditReferenceConflictError,
  InsufficientCreditsError,
  consumeCredits,
} from "@/lib/saas/billing";
import {
  CREDIT_USAGE_COSTS,
  isMeteredUsage,
  isSafeCreditReference,
} from "@/lib/saas/billing-core";
import { isSaasMode } from "@/lib/saas/runtime";

export async function POST(req: NextRequest) {
  if (!isSaasMode()) return NextResponse.json({ error: "Not Found" }, { status: 404 });
  const access = await requireApiIdentity();
  if (!access.ok) return access.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!isMeteredUsage(body.usage) || !isSafeCreditReference(body.referenceId)) {
    return NextResponse.json({ error: "Invalid usage or referenceId" }, { status: 400 });
  }

  try {
    const result = await consumeCredits(access.identity!.user.id, {
      amount: CREDIT_USAGE_COSTS[body.usage],
      source: body.usage,
      referenceId: body.referenceId,
      metadata: { channel: "billing_api" },
    });
    return NextResponse.json({
      balance: result.balance,
      transactionId: result.transactionId,
      idempotent: result.idempotent,
      charged: CREDIT_USAGE_COSTS[body.usage],
    });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return NextResponse.json({ error: "Insufficient credits" }, { status: 402 });
    }
    if (error instanceof CreditReferenceConflictError) {
      return NextResponse.json({ error: "Credit reference conflict" }, { status: 409 });
    }
    console.error("Credit consumption failed:", error);
    return NextResponse.json({ error: "Unable to consume credits" }, { status: 500 });
  }
}
