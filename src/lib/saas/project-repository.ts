import { and, desc, eq } from "drizzle-orm";
import { getSaasDb } from "@/lib/saas-db";
import { projects, type SaasProject } from "@/lib/saas-db/schema";

export interface CreateProjectInput {
  name: string;
  description?: string | null;
  status?: string;
  id?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  status?: string;
}

export interface ProjectRepository {
  getProjects(userId: string): Promise<SaasProject[]>;
  getProject(projectId: string, userId: string): Promise<SaasProject | null>;
  createProject(userId: string, data: CreateProjectInput): Promise<SaasProject>;
  updateProject(projectId: string, userId: string, data: UpdateProjectInput): Promise<SaasProject | null>;
  deleteProject(projectId: string, userId: string): Promise<boolean>;
}

export class PostgresProjectRepository implements ProjectRepository {
  async getProjects(userId: string): Promise<SaasProject[]> {
    return getSaasDb()
      .select()
      .from(projects)
      .where(eq(projects.userId, userId))
      .orderBy(desc(projects.updatedAt));
  }

  async getProject(projectId: string, userId: string): Promise<SaasProject | null> {
    const [project] = await getSaasDb()
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .limit(1);
    return project ?? null;
  }

  async createProject(userId: string, data: CreateProjectInput): Promise<SaasProject> {
    const [project] = await getSaasDb()
      .insert(projects)
      .values({
        ...(data.id ? { id: data.id } : {}),
        userId,
        name: data.name,
        description: data.description ?? null,
        status: data.status ?? "draft",
      })
      .returning();
    return project;
  }

  async updateProject(projectId: string, userId: string, data: UpdateProjectInput): Promise<SaasProject | null> {
    const [project] = await getSaasDb()
      .update(projects)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .returning();
    return project ?? null;
  }

  async deleteProject(projectId: string, userId: string): Promise<boolean> {
    const deleted = await getSaasDb()
      .delete(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .returning({ id: projects.id });
    return deleted.length === 1;
  }
}

export const projectRepository: ProjectRepository = new PostgresProjectRepository();
