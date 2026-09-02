import { requireProjectAccess } from "@/lib/saas/authorization";
import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { scripts as scriptsTable, projects, type Shot } from "@/lib/db/schema";
import { translateShots, defaultVoiceForLang, langName } from "@/lib/script-engine/translate";
import { apiError, errText } from "@/lib/api-error";

const SAFE_ID = /^[a-zA-Z0-9\-]+$/;

/**
 * POST /api/project/[id]/dub — Translate the currently selected script into a target language
 * and save it as a new selected script version (dubbed version).
 * Run a normal compose with the returned recommendedVoice to produce a re-voiced localized version
 * (for overseas distribution: same footage, different markets).
 * Visual search fields retain the original language; the dubbed version reuses the same visuals with only the audio/subtitles swapped.
 * body: { targetLang: string, llmConfig: {baseUrl,apiKey,model}, title? }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: accessProjectId } = await params;
  const projectAccess = await requireProjectAccess(accessProjectId);
  if (!projectAccess.ok) return projectAccess.response;
  const { id } = await params;
  if (!id || !SAFE_ID.test(id)) return apiError(req, "无效的项目ID", "Invalid project ID");

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* allow empty body; validated below */
  }
  const targetLang = typeof body.targetLang === "string" ? body.targetLang.trim() : "";
  if (!targetLang) return apiError(req, "请指定 targetLang（如 en/ja/ko/es）", "Please specify targetLang (e.g. en/ja/ko/es)");
  const llmConfig = body.llmConfig as { baseUrl?: string; apiKey?: string; model?: string } | undefined;
  if (!llmConfig?.baseUrl || !llmConfig?.model) {
    return apiError(req, "请配置 LLM 参数（baseUrl、model；本地/免费端点 apiKey 可留空）", "Please configure LLM parameters (baseUrl, model; apiKey may be left empty for local/free endpoints)");
  }

  const db = getDb();
  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  if (!project) return apiError(req, "项目不存在", "Project not found", 404);

  const rows = await db.select().from(scriptsTable).where(eq(scriptsTable.projectId, id));
  if (!rows.length) return apiError(req, "该项目还没有脚本", "This project has no script yet", 404);
  const source = rows.find((r) => r.selected) ?? rows[rows.length - 1];
  const shots = (source.shots ?? []) as Shot[];
  if (!shots.length) return apiError(req, "脚本没有分镜", "The script has no shots");

  let translated: Shot[];
  try {
    translated = await translateShots(shots, targetLang, {
      baseUrl: llmConfig.baseUrl,
      apiKey: llmConfig.apiKey ?? "",
      model: llmConfig.model,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : errText(req, "翻译失败", "Translation failed") }, { status: 502 });
  }
  const totalDuration = translated.reduce((sum, sh) => sum + sh.duration, 0);

  // Get the next version number; deselect old scripts and mark the dubbed version as current
  const [latest] = await db
    .select({ version: scriptsTable.version })
    .from(scriptsTable)
    .where(eq(scriptsTable.projectId, id))
    .orderBy(desc(scriptsTable.version))
    .limit(1);
  const nextVersion = (latest?.version ?? 0) + 1;
  await db.update(scriptsTable).set({ selected: false }).where(eq(scriptsTable.projectId, id));

  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim().slice(0, 80)
      : `[${langName(targetLang)}] ${source.title ?? "dub"}`.slice(0, 80);

  const [row] = await db
    .insert(scriptsTable)
    .values({ projectId: id, version: nextVersion, styleType: "custom", title, totalDuration, shots: translated, selected: true })
    .returning();

  return NextResponse.json({
    scriptId: row.id,
    version: nextVersion,
    targetLang,
    shots: translated.length,
    recommendedVoice: defaultVoiceForLang(targetLang),
  });
}
