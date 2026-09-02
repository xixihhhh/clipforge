import nextEnv from "@next/env";
import postgres from "postgres";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), false, { info() {}, error() {} });

if (process.env.RUN_LIVE_CREDITS_ACCEPTANCE !== "1") {
  console.error("Refusing to mutate credits without RUN_LIVE_CREDITS_ACCEPTANCE=1");
  process.exit(2);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("SaaS database configuration is unavailable");
  process.exit(2);
}

const sql = postgres(databaseUrl, { max: 8, prepare: false });
const targetLabel = "huahua";
const normalReference = "acceptance:huahua:100-to-90:v1";
const insufficientReference = "acceptance:huahua:insufficient-200:v1";
let ephemeralUserId;

function assert(condition, message) {
  if (!condition) throw new Error(`Acceptance assertion failed: ${message}`);
}

function isInsufficient(error) {
  return error instanceof Error && error.message.includes("insufficient_credits");
}

async function consume(userId, amount, source, referenceId, metadata = {}) {
  const [result] = await sql`
    select * from private.consume_credits(
      ${userId}::uuid,
      ${amount}::bigint,
      ${source}::text,
      ${referenceId}::text,
      ${sql.json(metadata)}::jsonb
    )
  `;
  return result;
}

async function asAuthenticated(authUserId, operation) {
  return sql.begin(async (tx) => {
    await tx`set local role authenticated`;
    await tx`select set_config('request.jwt.claim.sub', ${authUserId}::text, true)`;
    return operation(tx);
  });
}

async function cannotUpdateAs(authUserId, targetUserId) {
  try {
    await asAuthenticated(authUserId, (tx) => tx`
      update public.credit_accounts
      set balance = balance + 1
      where user_id = ${targetUserId}::uuid
    `);
    return false;
  } catch (error) {
    return error && typeof error === "object" && "code" in error && error.code === "42501";
  }
}

try {
  const targetUsers = await sql`
    select id, auth_user_id
    from public.users
    where lower(coalesce(display_name, '')) = ${targetLabel}
       or lower(split_part(coalesce(email, ''), '@', 1)) = ${targetLabel}
  `;
  assert(targetUsers.length === 1, "exactly one huahua account must exist");
  const target = targetUsers[0];

  const otherUsers = await sql`
    select id, auth_user_id
    from public.users
    where id <> ${target.id}::uuid
    order by created_at asc
    limit 1
  `;
  assert(otherUsers.length === 1, "a second account is required for isolation checks");
  const other = otherUsers[0];

  const [beforeAccount] = await sql`
    select balance from public.credit_accounts where user_id = ${target.id}::uuid
  `;
  assert(beforeAccount, "huahua credit account must exist");

  const existingNormal = await sql`
    select amount, balance_after, type, source, reference_id, created_at
    from public.credit_transactions
    where user_id = ${target.id}::uuid
      and source = 'ai_video'
      and reference_id = ${normalReference}
  `;

  const startingBalance = Number(beforeAccount.balance);
  if (startingBalance === 100 && existingNormal.length === 0) {
    const normalResult = await consume(target.id, 10, "ai_video", normalReference, {
      acceptance: "normal_deduction",
    });
    assert(Number(normalResult.new_balance) === 90, "normal deduction must return balance 90");
    assert(normalResult.idempotent === false, "first normal deduction must not be idempotent replay");
  } else {
    assert(startingBalance === 90, "huahua must start at 100 or already be at accepted balance 90");
    assert(existingNormal.length === 1, "existing acceptance deduction must have exactly one ledger row");
    const replay = await consume(target.id, 10, "ai_video", normalReference, {
      acceptance: "normal_deduction_replay",
    });
    assert(Number(replay.new_balance) === 90 && replay.idempotent === true, "replay must be idempotent");
  }

  const [afterNormal] = await sql`
    select balance from public.credit_accounts where user_id = ${target.id}::uuid
  `;
  assert(Number(afterNormal.balance) === 90, "huahua balance must be 90 after normal deduction");

  let insufficientRejected = false;
  try {
    await consume(target.id, 200, "ai_video", insufficientReference, {
      acceptance: "insufficient_balance",
    });
  } catch (error) {
    insufficientRejected = isInsufficient(error);
  }
  assert(insufficientRejected, "200-credit deduction must be rejected as insufficient");

  const [[afterInsufficient], insufficientLedger] = await Promise.all([
    sql`select balance from public.credit_accounts where user_id = ${target.id}::uuid`,
    sql`
      select count(*)::int as count
      from public.credit_transactions
      where user_id = ${target.id}::uuid and reference_id = ${insufficientReference}
    `,
  ]);
  assert(Number(afterInsufficient.balance) === 90, "failed deduction must preserve balance 90");
  assert(insufficientLedger[0].count === 0, "failed deduction must not create a ledger row");

  const ledgerRows = await sql`
    select user_id, amount, balance_after, type, source, reference_id, created_at
    from public.credit_transactions
    where user_id = ${target.id}::uuid
      and source = 'ai_video'
      and reference_id = ${normalReference}
  `;
  assert(ledgerRows.length === 1, "normal deduction must create one ledger row");
  const ledger = ledgerRows[0];
  assert(Number(ledger.amount) === -10, "ledger amount must be -10");
  assert(Number(ledger.balance_after) === 90, "ledger balance_after must be 90");
  assert(ledger.type === "consume" && ledger.source === "ai_video", "ledger type/source must match");
  assert(Boolean(ledger.user_id && ledger.reference_id && ledger.created_at), "ledger audit fields are required");

  const aReadsB = await asAuthenticated(other.auth_user_id, (tx) => tx`
    select count(*)::int as count
    from public.credit_accounts
    where user_id = ${target.id}::uuid
  `);
  const aReadsBHistory = await asAuthenticated(other.auth_user_id, (tx) => tx`
    select count(*)::int as count
    from public.credit_transactions
    where user_id = ${target.id}::uuid
  `);
  const bReadsA = await asAuthenticated(target.auth_user_id, (tx) => tx`
    select count(*)::int as count
    from public.credit_accounts
    where user_id = ${other.id}::uuid
  `);
  const bReadsAHistory = await asAuthenticated(target.auth_user_id, (tx) => tx`
    select count(*)::int as count
    from public.credit_transactions
    where user_id = ${other.id}::uuid
  `);
  assert(aReadsB[0].count === 0 && aReadsBHistory[0].count === 0, "A must not read B billing data");
  assert(bReadsA[0].count === 0 && bReadsAHistory[0].count === 0, "B must not read A billing data");

  const [aCannotUpdateB, bCannotUpdateA] = await Promise.all([
    cannotUpdateAs(other.auth_user_id, target.id),
    cannotUpdateAs(target.auth_user_id, other.id),
  ]);
  assert(aCannotUpdateB && bCannotUpdateA, "authenticated users must not update credit balances");

  const [ephemeral] = await sql`
    insert into public.users (auth_user_id, email, display_name)
    values (gen_random_uuid(), null, '__credits_acceptance_ephemeral__')
    returning id
  `;
  ephemeralUserId = ephemeral.id;

  const sameReference = "acceptance:ephemeral:idempotency:v1";
  const sameResults = await Promise.all([
    consume(ephemeralUserId, 10, "ai_image", sameReference, { attempt: 1 }),
    consume(ephemeralUserId, 10, "ai_image", sameReference, { attempt: 2 }),
  ]);
  assert(Number(sameResults[0].new_balance) === 90, "same-reference first result must be 90");
  assert(Number(sameResults[1].new_balance) === 90, "same-reference replay result must be 90");
  assert(
    sameResults.filter((result) => result.idempotent === false).length === 1,
    "same reference must charge exactly once",
  );

  const concurrentReferences = [
    "acceptance:ephemeral:concurrent-a:v1",
    "acceptance:ephemeral:concurrent-b:v1",
  ];
  const concurrentResults = await Promise.allSettled(
    concurrentReferences.map((referenceId) =>
      consume(ephemeralUserId, 60, "ai_video", referenceId, { acceptance: "concurrency" }),
    ),
  );
  const concurrentSucceeded = concurrentResults.filter((result) => result.status === "fulfilled").length;
  const concurrentInsufficient = concurrentResults.filter(
    (result) => result.status === "rejected" && isInsufficient(result.reason),
  ).length;
  assert(concurrentSucceeded === 1 && concurrentInsufficient === 1, "only one competing debit may succeed");

  const [[ephemeralAccount], ephemeralLedger] = await Promise.all([
    sql`select balance from public.credit_accounts where user_id = ${ephemeralUserId}::uuid`,
    sql`
      select amount, balance_after
      from public.credit_transactions
      where user_id = ${ephemeralUserId}::uuid
      order by created_at asc
    `,
  ]);
  assert(Number(ephemeralAccount.balance) === 30, "concurrent test balance must be 30, never negative");
  assert(
    ephemeralLedger.reduce((sum, row) => sum + Number(row.amount), 0) === 30,
    "ledger sum must equal the final balance",
  );

  console.log(JSON.stringify({
    normalDeduction: { before: 100, amount: -10, after: 90, passed: true },
    insufficientDeduction: { attempted: 200, after: 90, ledgerRows: 0, passed: true },
    concurrency: {
      sameReferenceChargedOnce: true,
      competingDebitsSucceeded: concurrentSucceeded,
      competingDebitsRejected: concurrentInsufficient,
      negativeBalance: false,
      passed: true,
    },
    isolation: {
      crossAccountBalanceRowsVisible: 0,
      crossAccountHistoryRowsVisible: 0,
      authenticatedDirectUpdateRejected: true,
      passed: true,
    },
    ledger: {
      amount: -10,
      balanceAfter: 90,
      requiredAuditFieldsPresent: true,
      passed: true,
    },
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Credit acceptance failed");
  process.exitCode = 1;
} finally {
  if (ephemeralUserId) {
    try {
      await sql`delete from public.users where id = ${ephemeralUserId}::uuid`;
    } catch {
      console.error("Ephemeral acceptance user cleanup failed");
      process.exitCode = 1;
    }
  }
  await sql.end({ timeout: 5 });
}
