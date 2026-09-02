import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { projects as localProjects } from "@/lib/db/schema";
import type { SaasProject } from "@/lib/saas-db/schema";
import type {
  CreateProjectInput,
  ProjectRepository,
  UpdateProjectInput,
} from "@/lib/saas/project-repository";

function toProject(row: typeof localProjects.$inferSelect): SaasProject {
  return {
    id: row.id,
    userId: "local",
    name: row.name,
    description: null,
    status: row.status,
    createdAt: row.createdAt ?? new Date(0),
    updatedAt: row.updatedAt ?? row.createdAt ?? new Date(0),
  };
}

/** Electron/local adapter. userId is intentionally ignored because the desktop database is single-user. */
export class LocalProjectRepository implements ProjectRepository {
  async getProjects(userId: string): Promise<SaasProject[]> {
    void userId;
    const rows = await getDb().select().from(localProjects).orderBy(desc(localProjects.updatedAt));
    return rows.map(toProject);
  }

  async getProject(projectId: string, userId: string): Promise<SaasProject | null> {
    void userId;
    const [row] = await getDb().select().from(localProjects).where(eq(localProjects.id, projectId)).limit(1);
    return row ? toProject(row) : null;
  }

  async createProject(userId: string, data: CreateProjectInput): Promise<SaasProject> {
    void userId;
    const [row] = await getDb()
      .insert(localProjects)
      .values({ id: data.id, name: data.name, status: normalizeStatus(data.status) })
      .returning();
    return toProject(row);
  }

  async updateProject(projectId: string, userId: string, data: UpdateProjectInput): Promise<SaasProject | null> {
    void userId;
    const [row] = await getDb()
      .update(localProjects)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.status !== undefined ? { status: normalizeStatus(data.status) } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(localProjects.id, projectId)))
      .returning();
    return row ? toProject(row) : null;
  }

  async deleteProject(projectId: string, userId: string): Promise<boolean> {
    void userId;
    const rows = await getDb().delete(localProjects).where(eq(localProjects.id, projectId)).returning({ id: localProjects.id });
    return rows.length === 1;
  }
}

function normalizeStatus(status?: string): "draft" | "scripting" | "assets" | "video" | "composing" | "done" {
  const allowed = ["draft", "scripting", "assets", "video", "composing", "done"] as const;
  return allowed.find((value) => value === status) ?? "draft";
}
