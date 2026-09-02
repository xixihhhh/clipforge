import "server-only";

import type { User } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { getSaasDb } from "@/lib/saas-db";
import { users, type SaasUser } from "@/lib/saas-db/schema";
import { ensureBillingProfile } from "@/lib/saas/billing";

export async function ensureAppUser(authUser: User): Promise<SaasUser> {
  const displayName =
    (typeof authUser.user_metadata?.display_name === "string" && authUser.user_metadata.display_name) ||
    (typeof authUser.user_metadata?.full_name === "string" && authUser.user_metadata.full_name) ||
    null;
  const avatarUrl =
    typeof authUser.user_metadata?.avatar_url === "string" ? authUser.user_metadata.avatar_url : null;

  const [user] = await getSaasDb()
    .insert(users)
    .values({
      authUserId: authUser.id,
      email: authUser.email ?? null,
      displayName,
      avatarUrl,
    })
    .onConflictDoUpdate({
      target: users.authUserId,
      set: {
        email: authUser.email ?? null,
        displayName,
        avatarUrl,
        updatedAt: new Date(),
      },
    })
    .returning();
  await ensureBillingProfile(user.id);
  return user;
}

export async function findAppUser(authUserId: string): Promise<SaasUser | null> {
  const [user] = await getSaasDb().select().from(users).where(eq(users.authUserId, authUserId)).limit(1);
  return user ?? null;
}
