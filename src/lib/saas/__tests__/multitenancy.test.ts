import { describe, expect, it } from "vitest";
import type { SaasProject } from "@/lib/saas-db/schema";
import type { CreateProjectInput, ProjectRepository, UpdateProjectInput } from "@/lib/saas/project-repository";
import { decideProjectAccess } from "@/lib/saas/project-access";
import { mediaReferencesBelongToProject } from "@/lib/saas/media-access";

class InMemoryProjectRepository implements ProjectRepository {
  private rows = new Map<string, SaasProject>();

  async getProjects(userId: string) {
    return [...this.rows.values()].filter((row) => row.userId === userId);
  }
  async getProject(projectId: string, userId: string) {
    const row = this.rows.get(projectId);
    return row?.userId === userId ? row : null;
  }
  async createProject(userId: string, data: CreateProjectInput) {
    const now = new Date();
    const row: SaasProject = { id: data.id ?? crypto.randomUUID(), userId, name: data.name, description: data.description ?? null, status: data.status ?? "draft", createdAt: now, updatedAt: now };
    this.rows.set(row.id, row);
    return row;
  }
  async updateProject(projectId: string, userId: string, data: UpdateProjectInput) {
    const current = await this.getProject(projectId, userId);
    if (!current) return null;
    const next = { ...current, ...data, updatedAt: new Date() };
    this.rows.set(projectId, next);
    return next;
  }
  async deleteProject(projectId: string, userId: string) {
    if (!(await this.getProject(projectId, userId))) return false;
    return this.rows.delete(projectId);
  }
}

describe("SaaS project multi-tenancy", () => {
  it("Test 1: user A creates a project", async () => {
    const repository = new InMemoryProjectRepository();
    const project = await repository.createProject("user-a", { name: "A project" });
    expect(project.userId).toBe("user-a");
  });

  it("Test 2: user A can read their own project", async () => {
    const repository = new InMemoryProjectRepository();
    const project = await repository.createProject("user-a", { name: "A project" });
    await expect(repository.getProject(project.id, "user-a")).resolves.toMatchObject({ id: project.id });
  });

  it("Test 3: user B cannot read user A's project", async () => {
    const repository = new InMemoryProjectRepository();
    const project = await repository.createProject("user-a", { name: "A project" });
    await expect(decideProjectAccess("user-b", project.id, repository)).resolves.toEqual({ allowed: false, status: 403 });
  });

  it("Test 4: user B cannot update user A's project", async () => {
    const repository = new InMemoryProjectRepository();
    const project = await repository.createProject("user-a", { name: "A project" });
    await expect(repository.updateProject(project.id, "user-b", { name: "stolen" })).resolves.toBeNull();
    await expect(repository.getProject(project.id, "user-a")).resolves.toMatchObject({ name: "A project" });
  });

  it("Test 5: user B cannot delete user A's project", async () => {
    const repository = new InMemoryProjectRepository();
    const project = await repository.createProject("user-a", { name: "A project" });
    await expect(repository.deleteProject(project.id, "user-b")).resolves.toBe(false);
    await expect(repository.getProject(project.id, "user-a")).resolves.not.toBeNull();
  });

  it("Test 6: unauthenticated project API access is rejected", async () => {
    const repository = new InMemoryProjectRepository();
    const project = await repository.createProject("user-a", { name: "A project" });
    await expect(decideProjectAccess(null, project.id, repository)).resolves.toEqual({ allowed: false, status: 401 });
  });

  it("Test 7: user B cannot reuse user A's local media reference", () => {
    expect(mediaReferencesBelongToProject("project-b", ["/api/files/project-a/private.png"])).toBe(false);
    expect(mediaReferencesBelongToProject("project-b", ["/api/output/project-a/final.mp4"])).toBe(false);
  });

  it("Test 8: a project can use its own local media and external references", () => {
    expect(
      mediaReferencesBelongToProject("project-a", [
        "/api/files/project-a/product.png",
        "/api/output/project-a/final.mp4",
        "https://cdn.example.com/reference.png",
        "data:image/png;base64,AA==",
      ]),
    ).toBe(true);
  });
});
