import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

describe("SaaS server-side security boundaries", () => {
  it("guards AI image and video generation with project ownership", () => {
    for (const route of ["src/app/api/ai/image/route.ts", "src/app/api/ai/video/route.ts"]) {
      const code = source(route);
      expect(code).toContain("requireProjectAccess(projectId)");
      expect(code).toContain("mediaReferencesBelongToProject");
    }
  });

  it("resolves a persisted task before authorizing cloud-task resume", () => {
    const code = source("src/app/api/ai/video/task/route.ts");
    expect(code).toContain("findAiTaskByProviderTaskId");
    expect(code).toContain("requireProjectAccess(persistedTask.projectId)");
  });

  it("guards direct project page URLs on the server", () => {
    expect(source("src/app/project/[id]/layout.tsx")).toContain("requireProjectPageAccess(id)");
  });

  it("protects the dashboard in both proxy and server layout", () => {
    expect(source("src/proxy.ts")).toContain('path === "/dashboard"');
    expect(source("src/app/dashboard/layout.tsx")).toContain("requirePageUser()");
  });
});
