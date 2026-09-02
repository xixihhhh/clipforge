import "server-only";

import { cache } from "react";
import { NextResponse } from "next/server";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureAppUser } from "@/lib/saas/users";
import { projectRepository, type ProjectRepository } from "@/lib/saas/project-repository";
import { isSaasMode } from "@/lib/saas/runtime";
import type { SaasProject, SaasUser } from "@/lib/saas-db/schema";
import { decideProjectAccess } from "@/lib/saas/project-access";

export type ApiIdentity = { authUserId: string; user: SaasUser };

export const getOptionalApiIdentity = cache(async (): Promise<ApiIdentity | null> => {
  if (!isSaasMode()) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { authUserId: data.user.id, user: await ensureAppUser(data.user) };
});

export async function requirePageUser(): Promise<ApiIdentity> {
  const identity = await getOptionalApiIdentity();
  if (!identity) redirect("/login");
  return identity;
}

/** Server-component guard for every legacy `/project/[id]/**` page. */
export async function requireProjectPageAccess(projectId: string): Promise<ProjectAccessResult> {
  if (!isSaasMode()) return { ok: true, identity: null, project: null };
  const identity = await getOptionalApiIdentity();
  if (!identity) redirect("/login");
  const access = await authorizeProjectAccess(identity, projectId);
  if (!access.ok) notFound();
  return access;
}

export type ProjectAccessResult =
  | { ok: true; identity: ApiIdentity | null; project: SaasProject | null }
  | { ok: false; response: NextResponse };

export async function authorizeProjectAccess(
  identity: ApiIdentity | null,
  projectId: string,
  repository: ProjectRepository = projectRepository,
): Promise<ProjectAccessResult> {
  const decision = await decideProjectAccess(identity?.user.id ?? null, projectId, repository);
  if (!decision.allowed) {
    const error = decision.status === 401 ? "Unauthorized" : "Forbidden";
    return { ok: false, response: NextResponse.json({ error }, { status: decision.status }) };
  }
  return { ok: true, identity, project: decision.project };
}

export async function requireProjectAccess(projectId: string): Promise<ProjectAccessResult> {
  if (!isSaasMode()) return { ok: true, identity: null, project: null };
  return authorizeProjectAccess(await getOptionalApiIdentity(), projectId);
}

export async function requireApiIdentity(): Promise<
  { ok: true; identity: ApiIdentity | null } | { ok: false; response: NextResponse }
> {
  if (!isSaasMode()) return { ok: true, identity: null };
  const identity = await getOptionalApiIdentity();
  if (!identity) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { ok: true, identity };
}
