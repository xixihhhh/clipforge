import { describe, expect, it } from "vitest";
import { publicMediaComposition, publicMediaSource } from "@/lib/public-media-source";

describe("publicMediaSource", () => {
  it("keeps browser fields while removing the absolute source path", () => {
    const now = new Date("2026-08-25T00:00:00.000Z");
    const source: Parameters<typeof publicMediaSource>[0] = {
      id: "media-1",
      projectId: "project-1",
      originalName: "source.mp4",
      filePath: "/private/clipforge/source.mp4",
      mimeType: "video/mp4",
      sizeBytes: 1024,
      duration: 12_000,
      width: 1920,
      height: 1080,
      hasAudio: true,
      status: "ready",
      progress: 100,
      model: "whisper-tiny",
      device: "wasm",
      language: "zh",
    transcript: null,
    transcriptCheckpoint: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };

    const result = publicMediaSource(source);

    expect(result).toMatchObject({ id: "media-1", originalName: "source.mp4", status: "ready" });
    expect(result).not.toHaveProperty("filePath");
    expect(JSON.stringify(result)).not.toContain("/private/clipforge");
  });

  it("removes every server-side path from an edit composition", () => {
    const composition: Parameters<typeof publicMediaComposition>[0] = {
      id: "composition-1",
      scriptId: null,
      projectId: "project-1",
      outputPath: "/private/clipforge/output.mp4",
      thumbnailPath: "/private/clipforge/thumb.jpg",
      bgmPath: "/private/clipforge/bgm.mp3",
      resolution: "720p",
      aspectRatio: "16:9",
      duration: 9_680,
      ttsEnabled: false,
      subtitleStyle: null,
      aigcBadge: false,
      label: "Text edit · R1",
      status: "done",
      createdAt: new Date("2026-08-25T00:00:00.000Z"),
    };

    const result = publicMediaComposition(composition, {
      outputUrl: "/api/output/project-1/output.mp4",
      downloadUrl: "/api/output/project-1/output.mp4?download=1",
    });

    expect(result).toMatchObject({ id: "composition-1", status: "done" });
    expect(result).not.toHaveProperty("outputPath");
    expect(result).not.toHaveProperty("thumbnailPath");
    expect(result).not.toHaveProperty("bgmPath");
    expect(JSON.stringify(result)).not.toContain("/private/clipforge");
  });
});
