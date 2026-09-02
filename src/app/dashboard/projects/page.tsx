import { requirePageUser } from "@/lib/saas/authorization";
import { projectRepository } from "@/lib/saas/project-repository";
import { ProjectManager } from "@/components/saas/project-manager";

export default async function DashboardProjectsPage() {
  const { user } = await requirePageUser();
  const projects = await projectRepository.getProjects(user.id);
  return <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6"><ProjectManager initialProjects={projects} /></main>;
}
