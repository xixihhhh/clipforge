import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { assets, scripts, type Shot } from "@/lib/db/schema";

type Reader = Pick<ReturnType<typeof getDb>, "select">;

export class ShotConflict extends Error {
  readonly status = 409;
}

export function scriptForProject(projectId: string, scriptId?: string | null, db: Reader = getDb()) {
  const rows = db.select().from(scripts).where(eq(scripts.projectId, projectId)).orderBy(desc(scripts.selected), desc(scripts.createdAt), desc(scripts.id)).all();
  if (!scriptId) return rows[0];
  const script = rows.find(row => row.id === scriptId);
  if (!script) throw new ShotConflict("脚本不存在或不属于此项目 / Script does not belong to this project");
  return script;
}

export function referenceLocked(shot: Shot): boolean {
  return Boolean((shot as Shot & { referenceCut?: { locked: boolean } }).referenceCut?.locked);
}

export function writableShot(projectId: string, scriptId: string | null | undefined, shotId: number, db: Reader = getDb()) {
  if (!scriptId && db.select({ id: scripts.id }).from(scripts).where(eq(scripts.projectId, projectId)).limit(2).all().length > 1) {
    throw new ShotConflict("此项目包含多个脚本，请指定 scriptId / Specify the script for this shot");
  }
  const script = scriptForProject(projectId, scriptId, db);
  const shot = script?.shots?.find(shot => shot.shotId === shotId);
  if (!shot || !script) throw new ShotConflict("此脚本中没有该分镜 / Shot not found in script");
  if (referenceLocked(shot)) throw new ShotConflict("请先解锁此参考镜头 / Unlock this reference shot first");
  return script.id;
}

export function sameShot(projectId: string, scriptId: string, shotId: number) {
  return and(eq(assets.projectId, projectId), eq(assets.scriptId, scriptId), eq(assets.shotId, shotId));
}
