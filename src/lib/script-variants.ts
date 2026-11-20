import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { assets, scripts } from "@/lib/db/schema";

type Variant = Omit<typeof scripts.$inferInsert, "projectId" | "version" | "selected">;

/** Keep previous script IDs addressable by their takes, paid jobs and exports. */
export function appendScriptVariants(projectId: string, variants: Variant[], dubbingSourceId?: string) {
  if (!variants.length) throw new Error("没有可保存的脚本 / No scripts to save");
  return getDb().transaction(tx => {
    const latest = tx.select({ version: scripts.version }).from(scripts).where(eq(scripts.projectId, projectId))
      .orderBy(desc(scripts.version)).limit(1).get();
    tx.update(scripts).set({ selected: false }).where(eq(scripts.projectId, projectId)).run();
    const rows = tx.insert(scripts).values(variants.map((variant, index) => ({
      ...variant, projectId, selected: index === 0, version: (latest?.version ?? 0) + index + 1,
    }))).returning().all();
    // Dubbing explicitly retains the source footage while replacing narration.
    // New rows share immutable files and preserve attribution; their selections are independent.
    if (dubbingSourceId) {
      const takes = tx.select().from(assets).where(and(eq(assets.projectId,projectId),eq(assets.scriptId,dubbingSourceId),eq(assets.selected,true),eq(assets.status,"done"))).all();
      const shots = new Set(rows[0].shots?.map(shot => shot.shotId));
      for (const take of takes) {
        if (shots.has(take.shotId)) tx.insert(assets).values({ ...take, id: crypto.randomUUID(), scriptId: rows[0].id, createdAt:new Date() }).run();
      }
    }
    return rows;
  });
}
