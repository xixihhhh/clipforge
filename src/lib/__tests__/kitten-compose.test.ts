// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { NextRequest } from "next/server";
import { afterAll, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { generateSpeech } from "@/lib/tts";
import { generateSpeechFreeDetailed } from "@/lib/edge-tts";
import { resolveTTSConfig } from "@/lib/tts-presets";
import { POST } from "@/app/api/project/[id]/compose/route";

vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/tts", async (original) => ({
  ...await original<typeof import("@/lib/tts")>(), generateSpeech: vi.fn().mockRejectedValue(new Error("local server stopped")),
}));
vi.mock("@/lib/edge-tts", async (original) => ({
  ...await original<typeof import("@/lib/edge-tts")>(), generateSpeechFreeDetailed: vi.fn(),
}));

const dir = mkdtempSync(join(tmpdir(), "clipforge-local-voice-"));
const sqlite = new Database(":memory:");
const db = drizzle(sqlite, { schema });
afterAll(() => { sqlite.close(); rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });

it("fails a local narration request without submitting its text to the Edge fallback", async () => {
  vi.stubEnv("APP_DATA_DIR", dir);
  migrate(db, { migrationsFolder: "drizzle" });
  const id = "local-voice";
  mkdirSync(join(dir, "uploads", id), { recursive: true });
  writeFileSync(join(dir, "uploads", id, "input.png"), "unused: synthesis fails before rendering");
  db.insert(schema.projects).values({ id, name: id, productImages: [`/api/files/${id}/input.png`] }).run();
  db.insert(schema.scripts).values({ projectId: id, styleType: "custom", selected: true, shots: [{
    shotId: 1, duration: 3, type: "demo", camera: "static", transition: "direct_concat",
    visualSource: "product_image", description: "Product", voiceover: "Bonjour.",
  }] }).run();
  const cfg = resolveTTSConfig({ enabled: true, provider: "kitten", voice: "fr" }, {});
  const req = new NextRequest("http://localhost/compose", {
    method: "POST", body: JSON.stringify({ ttsConfig: cfg, freeTts: { enabled: true } }),
  });
  expect((await POST(req, { params: Promise.resolve({ id }) })).status).toBe(202);
  await vi.waitFor(() => expect(db.select().from(schema.compositions).get()?.status).toBe("failed"));
  expect(generateSpeech).toHaveBeenCalledOnce();
  expect(generateSpeechFreeDetailed).not.toHaveBeenCalled();
});
