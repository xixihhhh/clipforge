import { NextResponse } from "next/server";
import { execSync } from "child_process";

export async function GET() {
  const appVersion = process.env.npm_package_version || "0.1.0";
  const nodeVersion = process.version;

  let ffmpegVersion = "未安装";
  try {
    const raw = execSync("ffmpeg -version 2>&1", { timeout: 5000 }).toString();
    // 兼容不同格式：`ffmpeg version 6.0` / `ffmpeg version N-12345`
    const match = raw.match(/ffmpeg version\s+(\S+)/i);
    ffmpegVersion = match ? match[1] : raw.split("\n")[0].trim();
  } catch {
    // FFmpeg not found
  }

  const platform = process.platform;
  const arch = process.arch;
  const uptime = process.uptime();

  return NextResponse.json({
    appVersion,
    nodeVersion,
    ffmpegVersion,
    platform,
    arch,
    uptime: Math.floor(uptime),
  });
}
export const dynamic = 'force-static';
