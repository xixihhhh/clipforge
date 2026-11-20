// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { NextRequest } from "next/server";
import * as schema from "@/lib/db/schema";
import { POST } from "@/app/api/project/[id]/stock-fill/route";
import { fillShotStock } from "@/lib/stock-fill";
import { rerankShotCandidates } from "@/lib/semantic-match";

vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/stock-fill", () => ({
  fillShotStock: vi.fn(async () => ({ provider: "local", mediaType: "image" })),
  searchShotCandidates: vi.fn(),
  persistCandidate: vi.fn(),
}));
vi.mock("@/lib/semantic-match", () => ({ rerankShotCandidates: vi.fn() }));

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
beforeEach(() => {
  sqlite = new Database(":memory:");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "drizzle" });
  db.insert(schema.projects)
    .values({ id: "fill-test", name: "Local fill" })
    .run();
  const shots = Array.from({ length: 7 }, (_, index) => ({
    shotId: index + 1,
    duration: 3,
    type: "demo" as const,
    camera: "static",
    transition: "direct_concat" as const,
    visualSource:
      index === 6 ? ("product_image" as const) : ("ai_generate" as const),
    description: "Coffee on a table",
    voiceover: "Coffee",
    stockKeywords: ["coffee"],
  }));
  db.insert(schema.scripts)
    .values({
      id: "fill-script", projectId: "fill-test",
      styleType: "custom",
      selected: true,
      shots,
    })
    .run();
  const states = ["done", "pending", "generating", "failed"] as const;
  db.insert(schema.assets)
    .values(
      states.map((status, index) => ({
        projectId: "fill-test", scriptId: "fill-script",
        shotId: index + 1,
        type: "user_upload" as const,
        selected: true,
        status,
      })),
    )
    .run();
  // An old successful take must not hide a selected failure or an otherwise empty shot.
  db.insert(schema.assets)
    .values(
      [4, 5].map((shotId) => ({
        projectId: "fill-test", scriptId: "fill-script",
        shotId,
        type: "user_upload" as const,
        selected: false,
        status: "done" as const,
      })),
    )
    .run();
});
afterEach(() => {
  sqlite.close();
  vi.clearAllMocks();
});

it("fills failed and empty shots while protecting ready, pending, generating and product shots", async () => {
  const response = await POST(
    new NextRequest("http://localhost/api/project/fill-test/stock-fill", {
      method: "POST",
      body: JSON.stringify({ source: "local", mediaType: "auto" }),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ id: "fill-test" }) },
  );
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.filled).toBe(3);
  expect(
    vi
      .mocked(fillShotStock)
      .mock.calls.map(([input]) => input.shotId)
      .sort(),
  ).toEqual([4, 5, 6]);
  expect(
    vi
      .mocked(fillShotStock)
      .mock.calls.every(([input]) => input.source === "local"),
  ).toBe(true);
  expect(rerankShotCandidates).not.toHaveBeenCalled();
});
