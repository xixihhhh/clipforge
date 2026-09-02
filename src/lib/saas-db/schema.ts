import { sql } from "drizzle-orm";
import { bigint, check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

export type SubscriptionPlan = "free" | "pro" | "business" | "team";
export type SubscriptionStatus = "active" | "trialing" | "past_due" | "canceled" | "incomplete" | "paused";
export type CreditTransactionType = "grant" | "consume" | "refund" | "adjustment";
export type CreditTransactionSource =
  | "signup_bonus"
  | "plan_grant"
  | "ai_video"
  | "ai_image"
  | "tts"
  | "manual"
  | "refund"
  | "rollback";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authUserId: uuid("auth_user_id").notNull(),
    email: varchar("email", { length: 320 }),
    displayName: varchar("display_name", { length: 160 }),
    avatarUrl: varchar("avatar_url", { length: 2048 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_auth_user_id_unique").on(table.authUserId)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    status: varchar("status", { length: 32 }).notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("projects_user_id_idx").on(table.userId),
    index("projects_user_updated_at_idx").on(table.userId, table.updatedAt),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    plan: varchar("plan", { length: 32 }).$type<SubscriptionPlan>().notNull().default("free"),
    status: varchar("subscription_status", { length: 32 }).$type<SubscriptionStatus>().notNull().default("active"),
    stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
    stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    priceId: varchar("price_id", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("subscriptions_user_id_unique").on(table.userId),
    uniqueIndex("subscriptions_stripe_customer_id_unique").on(table.stripeCustomerId),
    uniqueIndex("subscriptions_stripe_subscription_id_unique").on(table.stripeSubscriptionId),
  ],
);

export const creditAccounts = pgTable(
  "credit_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    balance: bigint("balance", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("credit_accounts_user_id_unique").on(table.userId),
    check("credit_accounts_balance_nonnegative", sql`${table.balance} >= 0`),
  ],
);

export const creditTransactions = pgTable(
  "credit_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amount: bigint("amount", { mode: "number" }).notNull(),
    balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
    type: varchar("type", { length: 32 }).$type<CreditTransactionType>().notNull(),
    source: varchar("source", { length: 64 }).$type<CreditTransactionSource>().notNull(),
    referenceId: varchar("reference_id", { length: 255 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("credit_transactions_user_created_at_idx").on(table.userId, table.createdAt),
    uniqueIndex("credit_transactions_user_source_reference_unique")
      .on(table.userId, table.source, table.referenceId)
      .where(sql`${table.referenceId} is not null`),
    check("credit_transactions_amount_nonzero", sql`${table.amount} <> 0`),
    check("credit_transactions_balance_after_nonnegative", sql`${table.balanceAfter} >= 0`),
  ],
);

export type SaasUser = typeof users.$inferSelect;
export type SaasProject = typeof projects.$inferSelect;
export type NewSaasProject = Pick<typeof projects.$inferInsert, "name" | "description" | "status">;
export type SaasSubscription = typeof subscriptions.$inferSelect;
export type CreditAccount = typeof creditAccounts.$inferSelect;
export type CreditTransaction = typeof creditTransactions.$inferSelect;
