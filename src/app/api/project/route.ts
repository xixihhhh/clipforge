import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { isSaasMode } from "@/lib/saas/runtime";
import { projectRepository } from "@/lib/saas/project-repository";
import { requireApiIdentity } from "@/lib/saas/authorization";

// fetch project list, most recently edited first (the /start "continue" cards rely on this order)
export async function GET() {
  try {
    if (isSaasMode()) {
      const access = await requireApiIdentity();
      if (!access.ok) return access.response;
      const result = await projectRepository.getProjects(access.identity!.user.id);
      return NextResponse.json(result);
    }
    const db = getDb();
    const result = await db.select().from(projects).orderBy(desc(projects.updatedAt));
    return NextResponse.json(result);
  } catch (error) {
    console.error("获取项目列表失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取项目列表失败" },
      { status: 500 }
    );
  }
}

// create a new project
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const db = getDb();

    // validate videoMode / sourceType against enum allowlists; fall back to default for invalid values
    const VIDEO_MODES = ["product_closeup", "graphic_montage", "scene_demo", "live_presenter"];
    const videoMode = VIDEO_MODES.includes(body.videoMode) ? body.videoMode : undefined;
    const sourceType = body.sourceType === "clone" ? "clone" : undefined;

    if (isSaasMode()) {
      const access = await requireApiIdentity();
      if (!access.ok) return access.response;
      const saasProject = await projectRepository.createProject(access.identity!.user.id, {
        name: String(body.name || "Untitled Project").slice(0, 255),
        description: typeof body.description === "string" ? body.description.slice(0, 5000) : null,
      });
      try {
        await db.insert(projects).values({
          id: saasProject.id,
          name: saasProject.name,
          productName: body.productName,
          productCategory: body.productCategory,
          productDescription: body.productDescription,
          productImages: body.productImages || [],
          ...(videoMode && { videoMode }),
          ...(sourceType && { sourceType }),
          ...(body.sourceVideoUrl && { sourceVideoUrl: body.sourceVideoUrl }),
        });
      } catch (error) {
        await projectRepository.deleteProject(saasProject.id, access.identity!.user.id);
        throw error;
      }
      return NextResponse.json(saasProject, { status: 201 });
    }

    const newProject = await db
      .insert(projects)
      .values({
        name: body.name || "未命名项目",
        productName: body.productName,
        productCategory: body.productCategory,
        productDescription: body.productDescription,
        productImages: body.productImages || [],
        ...(videoMode && { videoMode }),
        ...(sourceType && { sourceType }),
        ...(body.sourceVideoUrl && { sourceVideoUrl: body.sourceVideoUrl }),
      })
      .returning();

    return NextResponse.json(newProject[0], { status: 201 });
  } catch (error) {
    console.error("创建项目失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建项目失败" },
      { status: 500 }
    );
  }
}
