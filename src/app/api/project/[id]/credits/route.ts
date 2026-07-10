import { NextRequest, NextResponse } from "next/server";
import { eq, desc, and } from "drizzle-orm";
import { join } from "path";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { getDb } from "@/lib/db";
import { getDataDir } from "@/lib/paths";
import { projects, assets as assetsTable, compositions } from "@/lib/db/schema";
import { buildCreditsManifest, renderCreditsMarkdown, type BgmCredit } from "@/lib/asset-credits";
import { apiError } from "@/lib/api-error";

const SAFE_ID = /^[a-zA-Z0-9\-]+$/;

/**
 * GET /api/project/[id]/credits?format=json|md&lang=zh|en — export the asset license manifest:
 * per-shot provenance (source/author/license) with commercial-risk classification (NC/ND/unknown →
 * manual review), paste-ready attribution lines for CC BY assets, and the BGM credit (read from the
 * sidecar free-bgm writes at download time). Solves "free footage has no licensing proof → ad review
 * rejects the video" — attach the manifest when submitting paid traffic.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || !SAFE_ID.test(id)) return apiError(req, "无效的项目ID", "Invalid project ID");

  const url = new URL(req.url);
  const format = url.searchParams.get("format") === "md" ? "md" : "json";
  const lang = url.searchParams.get("lang") === "en" ? "en" : "zh";

  const db = getDb();
  const [proj] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!proj) return apiError(req, "项目不存在", "Project not found", 404);

  // newest asset per shot = what the latest composition actually used (older rows are replaced takes)
  const rows = await db
    .select()
    .from(assetsTable)
    .where(and(eq(assetsTable.projectId, id), eq(assetsTable.status, "done")))
    .orderBy(desc(assetsTable.createdAt));
  const seen = new Set<number>();
  const current = rows.filter((r) => {
    if (seen.has(r.shotId)) return false;
    seen.add(r.shotId);
    return true;
  });
  if (current.length === 0) {
    return apiError(req, "该项目还没有素材，先自动配画面或上传素材", "This project has no assets yet; auto-fill or upload materials first", 404);
  }

  // BGM provenance: free-bgm drops a .credit.json sidecar next to the downloaded track
  let bgm: BgmCredit | null = null;
  const [comp] = await db
    .select({ bgmPath: compositions.bgmPath })
    .from(compositions)
    .where(eq(compositions.projectId, id))
    .orderBy(desc(compositions.createdAt))
    .limit(1);
  if (comp?.bgmPath) {
    const bgmAbs = existsSync(comp.bgmPath) ? comp.bgmPath : join(getDataDir(), comp.bgmPath);
    try {
      bgm = JSON.parse(await readFile(`${bgmAbs}.credit.json`, "utf-8")) as BgmCredit;
    } catch {
      // no sidecar (paid/user BGM or track predating sidecars) — manifest simply omits the BGM entry
    }
  }

  const manifest = buildCreditsManifest(
    proj.name ?? proj.productName ?? id,
    current.map((r) => ({
      shotId: r.shotId,
      type: r.type,
      provider: r.provider,
      filePath: r.filePath,
      sourceUrl: r.sourceUrl,
      author: r.author,
      license: r.license,
    })),
    bgm
  );

  if (format === "md") {
    return new NextResponse(renderCreditsMarkdown(manifest, lang), {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="credits-${id}.md"`,
      },
    });
  }
  return NextResponse.json(manifest);
}
