import type { SaasProject } from "@/lib/saas-db/schema";
import type { ProjectRepository } from "@/lib/saas/project-repository";

export type ProjectAccessDecision =
  | { allowed: true; project: SaasProject }
  | { allowed: false; status: 401 | 403 };

export async function decideProjectAccess(
  userId: string | null,
  projectId: string,
  repository: ProjectRepository,
): Promise<ProjectAccessDecision> {
  if (!userId) return { allowed: false, status: 401 };
  const project = await repository.getProject(projectId, userId);
  if (!project) return { allowed: false, status: 403 };
  return { allowed: true, project };
}
