// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { afterAll, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { POST, PATCH } from "@/app/api/project/[id]/reference-cuts/route";
import { sourceCutPlan } from "@/lib/replicate-plan";

vi.mock("@/lib/db", () => ({ getDb: () => db }));
const sqlite = new Database(":memory:");
const db = drizzle(sqlite, { schema });
const dir = mkdtempSync(join(tmpdir(), "clipforge-cuts-"));
afterAll(() => { sqlite.close(); rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });

it("persists all eight half-second edits, forks their media, and locks only the selected version", async () => {
  vi.stubEnv("APP_DATA_DIR", dir);
  migrate(db, { migrationsFolder: "drizzle" });
  const id = "eight-shot-test";
  const products = ["red.png", "blue.png"].map((n) => `/api/files/${id}/${n}`);
  db.insert(schema.projects).values({ id, name: "Test", sourceType: "clone", productImages: products }).run();
  const ctx = { params: Promise.resolve({id}) };
  const request = (body: object) => new Request("http://localhost/reference", { method: "POST", body: JSON.stringify(body) });
  const cuts = sourceCutPlan([0.5, 1, 1.5, 2, 2.5, 3, 3.5], 4);
  expect(cuts).toHaveLength(8);
  mkdirSync(join(dir, "uploads", "replicate"), { recursive: true });
  writeFileSync(join(dir, "uploads", "replicate", "ref-demo.mp4.cuts.json"), JSON.stringify(cuts));
  const create = () => POST(request({ reference: "/api/files/replicate/ref-demo.mp4" }), ctx);
  const original = (await (await create()).json()).scriptId;
  expect((await (await create()).json()).scriptId).toBe(original);
  const edit = (scriptId: string, body: object) => PATCH(request({scriptId, shotId: 3, ...body}), ctx);
  expect((await edit(original, {action:"edit", description:"A", productImage: products[1]})).status).toBe(200);
  const copy = (await (await edit(original,{action:"duplicate"})).json()).scriptId;
  expect(copy).not.toBe(original);
  expect((await edit(copy, {action:"lock", locked:true})).status).toBe(200);
  expect((await edit(copy, {action:"edit", description:"B", productImage:products[0]})).status).toBe(409);
  expect((await edit(copy, {action:"lock", locked:false})).status).toBe(200);
  expect((await edit(copy, {action:"edit", description:"B", productImage:products[0]})).status).toBe(200);
  const takes = db.select().from(schema.assets).where(eq(schema.assets.selected,true)).all();
  expect(takes.map((t) => [t.scriptId,t.filePath])).toEqual([[original,products[1]],[copy,products[0]]]);
  for (const s of db.select().from(schema.scripts).all()) {
    expect(s.shots?.map((shot) => shot.duration)).toEqual(Array(8).fill(0.5));
    expect(s.shots?.[2]?.referenceCut?.start).toBe(1);
  }
});
