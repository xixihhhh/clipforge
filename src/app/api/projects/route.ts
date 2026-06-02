// @ts-nocheck
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq, desc, asc, like, or, and, sql, type SQL } from "drizzle-orm";

// ============================================================
// GET /api/projects
// 查询参数：
//   page       - 页码（默认 1）
//   pageSize   - 每页条数（默认 20，最大 100）
//   search     - 搜索关键词（模糊匹配 name / productName / productDescription）
//   status     - 按状态筛选（draft | scripting | assets | video | composing | done）
//   sortField  - 排序字段（name | status | createdAt | updatedAt，默认 createdAt）
//   sortOrder  - 排序方向（asc | desc，默认 desc）
// ============================================================
export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = request.nextUrl;

    // ---- 解析分页参数 ----
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10))
    );
    const offset = (page - 1) * pageSize;

    // ---- 解析搜索 / 筛选参数 ----
    const search = searchParams.get("search")?.trim() || "";
    const status = searchParams.get("status")?.trim() || "";

    // ---- 解析排序参数 ----
    const sortFieldParam = searchParams.get("sortField") || "createdAt";
    const sortOrderParam = searchParams.get("sortOrder") || "desc";

    // 映射排序字段（防止注入，只允许已知列）
    const sortFieldMap: Record<string, typeof projects.name> = {
      name: projects.name,
      status: projects.status,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    };
    const sortColumn = sortFieldMap[sortFieldParam] ?? projects.createdAt;
    const sortDirection = sortOrderParam === "asc" ? asc : desc;

    // ---- 构建 WHERE 条件 ----
    const conditions: SQL[] = [];

    // 搜索：模糊匹配 name / productName / productDescription
    if (search) {
      const pattern = `%${search}%`;
      conditions.push(
        or(
          like(projects.name, pattern),
          like(projects.productName, pattern),
          like(projects.productDescription, pattern)
        )!
      );
    }

    // 状态筛选
    if (status) {
      conditions.push(eq(projects.status, status as typeof projects.status._.data));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // ---- 查询总数 ----
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(projects)
      .where(whereClause);
    const total = countResult[0]?.count ?? 0;

    // ---- 查询分页数据 ----
    const data = await db
      .select()
      .from(projects)
      .where(whereClause)
      .orderBy(sortDirection(sortColumn))
      .limit(pageSize)
      .offset(offset);

    // ---- 返回带分页元信息的响应 ----
    return NextResponse.json({
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error("获取项目列表失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取项目列表失败" },
      { status: 500 }
    );
  }
}

// ============================================================
// POST /api/projects
// Body 字段：
//   name              *必填 - 项目名称
//   productName        可选 - 商品名称
//   productCategory    可选 - 商品品类
//   productDescription 可选 - 商品描述
//   productImages      可选 - 商品图片列表（string[]）
//   productId          可选 - 关联商品库 ID
//   brandId            可选 - 关联品牌设置 ID
//   templateId         可选 - 使用的脚本模板 ID
//   videoMode          可选 - 视频模式
//   sourceType         可选 - 来源类型（manual | clone）
//   sourceVideoUrl     可选 - 爆款复刻来源视频 URL
//   characterId        可选 - 出镜人物 ID
//
// 自动生成：
//   id         - UUID（schema $defaultFn）
//   status     - "draft"（schema default）
//   createdAt  - 当前时间
//   updatedAt  - 当前时间
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // 校验必填字段
    if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json(
        { error: "项目名称（name）为必填字段" },
        { status: 400 }
      );
    }

    const db = getDb();

    // 构建插入数据，只取合法字段，其余由 schema 默认值填充
    const insertData = {
      name: body.name.trim(),
      ...(body.productName !== undefined && { productName: body.productName }),
      ...(body.productCategory !== undefined && {
        productCategory: body.productCategory,
      }),
      ...(body.productDescription !== undefined && {
        productDescription: body.productDescription,
      }),
      ...(body.productImages !== undefined && {
        productImages: body.productImages,
      }),
      ...(body.productId !== undefined && { productId: body.productId }),
      ...(body.brandId !== undefined && { brandId: body.brandId }),
      ...(body.templateId !== undefined && { templateId: body.templateId }),
      ...(body.videoMode !== undefined && { videoMode: body.videoMode }),
      ...(body.sourceType !== undefined && { sourceType: body.sourceType }),
      ...(body.sourceVideoUrl !== undefined && {
        sourceVideoUrl: body.sourceVideoUrl,
      }),
      ...(body.characterId !== undefined && { characterId: body.characterId }),
    };

    const newProject = await db
      .insert(projects)
      .values(insertData)
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

// ============================================================
// DELETE /api/projects
// Body 字段：
//   id   - 单个删除（string）
//   ids  - 批量删除（string[]）
//
// 至少提供 id 或 ids 之一；ids 优先于 id。
// ============================================================
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const db = getDb();

    // 收集要删除的 ID 列表
    let idsToDelete: string[] = [];

    if (Array.isArray(body.ids) && body.ids.length > 0) {
      idsToDelete = body.ids.filter(
        (id: unknown): id is string => typeof id === "string" && id.trim() !== ""
      );
    } else if (body.id && typeof body.id === "string") {
      idsToDelete = [body.id];
    }

    if (idsToDelete.length === 0) {
      return NextResponse.json(
        { error: "请提供要删除的项目 id 或 ids 数组" },
        { status: 400 }
      );
    }

    // 逐个删除（SQLite 的 IN 语句对数组支持需要展开）
    // 由于项目表设置了 cascade 删除，关联的 scripts / assets / videoClips / compositions 会自动级联清理
    let deletedCount = 0;
    for (const id of idsToDelete) {
      const result = await db
        .delete(projects)
        .where(eq(projects.id, id))
        .returning();
      deletedCount += result.length;
    }

    return NextResponse.json({
      success: true,
      deleted: deletedCount,
      message:
        deletedCount > 0
          ? `成功删除 ${deletedCount} 个项目`
          : "未找到匹配的项目",
    });
  } catch (error) {
    console.error("删除项目失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除项目失败" },
      { status: 500 }
    );
  }
}
export const dynamic = 'force-static';
