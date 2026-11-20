import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { assets, projects, scripts, type Shot } from "@/lib/db/schema";
import { probeMedia } from "@/lib/media-probe";
import { resolveUploadFilePath } from "@/lib/remote-image";
import { getDataDir } from "@/lib/paths";
import type { ReplicateShot } from "@/lib/replicate-plan";

type Context = { params: Promise<{ id: string }> };

// The analysis is server-produced. Use the stored edit points on creation and on retries.
export async function POST(req: Request, { params }: Context) {
  const { id } = await params;
  const body = await req.json();
  const name = /^\/api\/files\/replicate\/(ref-[a-z0-9-]+\.(?:mp4|mov|webm))$/.exec(body.reference ?? "")?.[1];
  if (!name) return apiError(req, "请上传并分析参考片", "Analyze a reference video first", 400);
  let cuts: ReplicateShot[];
  try {
    cuts = JSON.parse(await readFile(join(getDataDir(), "uploads", "replicate", name + ".cuts.json"), "utf8"));
  } catch {
    return apiError(req, "请重新分析参考片", "Please analyze the reference again", 404);
  }
  return getDb().transaction((tx) => {
    const project = tx.select().from(projects).where(eq(projects.id, id)).get();
    const productImage = project?.productImages?.[0];
    if (!project || project.sourceType !== "clone" || !productImage || !cuts.length) {
      return apiError(req, "缺少复刻项目或商品图", "A reference project and product photo are required", 400);
    }
    const existing = tx.select().from(scripts).where(eq(scripts.projectId, id)).all();
    if (existing.length) {
      const current = existing.find((s) => s.selected && s.shots?.[0]?.referenceCut);
      return current && project.sourceVideoUrl === body.reference
        ? Response.json({ scriptId: current.id })
        : apiError(req, "该项目已有脚本", "This project already has a script", 409);
    }
    const shots: Shot[] = cuts.map((c) => ({
      shotId: c.index, type: "demo", duration: c.duration, description: project.productName ?? project.name,
      camera: "", visualSource: "ai_generate", transition: "direct_concat", motion: "static", voiceover: "",
      referenceCut: { start: c.start, end: c.start + c.duration, productImage, locked: false },
    }));
    const script = tx.insert(scripts).values({ projectId: id, title: "A", version: 1, selected: true,
      styleType: "custom", totalDuration: Math.round(shots[shots.length - 1].referenceCut!.end), shots }).returning().get();
    tx.update(projects).set({ sourceVideoUrl: body.reference, status: "assets", updatedAt: new Date() }).where(eq(projects.id, id)).run();
    return Response.json({ scriptId: script.id }, { status: 201 });
  });
}

export async function PATCH(req: Request, { params }: Context) {
  const { id } = await params;
  const body = await req.json();
  if (typeof body.scriptId !== "string") return apiError(req, "缺少脚本", "Missing script", 400);
  let mediaDuration = 0;
  if (body.action === "span") {
    const selected = getDb().select().from(assets).where(and(eq(assets.id, body.assetId),
      eq(assets.scriptId, body.scriptId), eq(assets.projectId, id), eq(assets.selected, true))).get();
    const path = selected?.filePath && resolveUploadFilePath(selected.filePath);
    if (!path || !/\.(mp4|mov|m4v|webm)$/i.test(path)) return apiError(req, "请选择已保存的视频素材", "Choose a saved video take", 400);
    mediaDuration = (await probeMedia(path)).duration;
  }
  return getDb().transaction((tx) => {
    const row = tx.select().from(scripts).where(and(eq(scripts.projectId, id), eq(scripts.id, body.scriptId))).get();
    const shots = row?.shots ?? [];
    if (!row || !shots.length || !shots.every((s) => s.referenceCut)) {
      return apiError(req, "参考时间线不存在", "Reference timeline not found", 404);
    }
    if (!row.selected) return apiError(req, "版本已切换，请刷新", "The active version changed. Refresh the editor.", 409);
    if (body.action === "duplicate") {
      const last = tx.select({ version: scripts.version }).from(scripts).where(eq(scripts.projectId, id)).orderBy(desc(scripts.version)).get();
      const version = (last?.version ?? 0) + 1;
      tx.update(scripts).set({ selected: false }).where(eq(scripts.projectId, id)).run();
      const copy = tx.insert(scripts).values({ projectId: id, styleType: row.styleType, selected: true,
        totalDuration: row.totalDuration, characters: row.characters, shots, version,
        title: version <= 26 ? String.fromCharCode(64 + version) : String(version) }).returning().get();
      // New records, shared immutable media. Selecting a different take in B never changes A.
      const chosen = tx.select().from(assets).where(and(eq(assets.projectId, id), eq(assets.scriptId, row.id), eq(assets.selected, true))).all();
      for (const take of chosen) tx.insert(assets).values({ ...take, id: crypto.randomUUID(), scriptId: copy.id }).run();
      return Response.json({ scriptId: copy.id });
    }
    const shot = shots.find((s) => s.shotId === body.shotId);
    const cut = shot?.referenceCut;
    if (!shot || !cut) return apiError(req, "镜头不存在", "Shot not found", 404);
    if (body.action === "span") {
      const from = shots.indexOf(shot);
      const to = shots.findIndex((s) => s.shotId === body.lastShotId);
      const source = tx.select().from(assets).where(and(eq(assets.id, body.assetId), eq(assets.projectId, id),
        eq(assets.scriptId, row.id), eq(assets.shotId, shot.shotId), eq(assets.selected, true))).get();
      if (!source?.filePath || to < from || !Number.isFinite(mediaDuration) || mediaDuration <= 0) {
        return apiError(req, "素材或镜头范围无效", "Invalid video or shot range", 409);
      }
      const span = shots.slice(from, to + 1);
      if (span.some((s) => s.referenceCut!.locked) || span[span.length - 1].referenceCut!.end - cut.start > mediaDuration + 0.001) {
        return apiError(req, "所选范围包含锁定镜头或超过素材时长", "The range contains a locked shot or exceeds the video duration", 409);
      }
      for (const s of span) {
        s.referenceCut!.segment = { path: source.filePath, offset: s.referenceCut!.start - cut.start };
        if (s.shotId === shot.shotId) continue;
        tx.update(assets).set({selected: false}).where(and(eq(assets.projectId, id), eq(assets.scriptId, row.id), eq(assets.shotId, s.shotId))).run();
        tx.insert(assets).values({ ...source, id: crypto.randomUUID(), shotId: s.shotId, createdAt: new Date() }).run();
      }
    } else if (body.action === "lock" && typeof body.locked === "boolean") {
      cut.locked = body.locked;
    } else if (body.action === "edit") {
      if (cut.locked) return apiError(req, "请先解锁这一镜", "Unlock this shot first", 409);
      if (typeof body.description !== "string" || !body.description.trim() || body.description.length > 2000) {
        return apiError(req, "镜头描述须在 1–2000 字符内", "Enter a shot description of 1–2000 characters", 400);
      }
      if (body.productImage !== cut.productImage) {
        const project = tx.select().from(projects).where(eq(projects.id, id)).get();
        if (typeof body.productImage !== "string" || !project?.productImages?.includes(body.productImage)) {
          return apiError(req, "请选择项目商品图", "Choose a product photo from this project", 400);
        }
        tx.update(assets).set({ selected: false }).where(and(eq(assets.projectId, id), eq(assets.scriptId, row.id), eq(assets.shotId, shot.shotId))).run();
        cut.productImage = body.productImage;
        tx.insert(assets).values({ projectId: id, scriptId: row.id, shotId: shot.shotId, filePath: body.productImage,
          type: "product_image", status: "done", selected: true }).run();
      }
      shot.description = body.description.trim();
      shot.prompt = shot.description;
    } else {
      return apiError(req, "不支持的操作", "Unsupported edit", 400);
    }
    tx.update(scripts).set({ shots }).where(eq(scripts.id, row.id)).run();
    return Response.json({ scriptId: row.id });
  });
}
