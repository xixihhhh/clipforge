import ffprobe from "@ffprobe-installer/ffprobe";
import ffmpegPath from "ffmpeg-static";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    exclude: ["e2e/**", "node_modules/**", ".next/**", "integrations/**", "release/**"],
    env: {
      FFMPEG_PATH: process.env.FFMPEG_PATH || ffmpegPath || "ffmpeg",
      FFPROBE_PATH: process.env.FFPROBE_PATH || ffprobe.path || "ffprobe",
    },
  },
});
