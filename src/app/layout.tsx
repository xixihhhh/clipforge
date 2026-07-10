import type { Metadata } from "next";
// self-hosted Geist via the official npm package (same --font-geist-* variables) — a build-time fetch
// from Google Fonts is a network dependency that intermittently breaks CI release builds
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { LocaleInitializer } from "@/components/locale-initializer";

const geistSans = GeistSans;
const geistMono = GeistMono;

export const metadata: Metadata = {
  // Title/description are bilingual (Chinese first): prioritize domestic traffic while covering overseas search indexing
  title: "ClipForge — AI 短视频带货创作工具 | AI Short Video Creator",
  description:
    "一句话主题或一张商品图，一键产出抖音 / 快手 / 小红书 / TikTok 竖屏带货短视频：AI 写脚本、自动配画面、免费配音、烧字幕。Turn one sentence or a product photo into a vertical short video — AI script, free stock footage, voiceover & subtitles in one click.",
  keywords: [
    "AI 短视频",
    "带货短视频",
    "AI 视频生成",
    "抖音",
    "快手",
    "小红书",
    "TikTok",
    "text to video",
    "faceless video",
    "AI video generator",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Site-wide default dark studio theme: pin the dark class on <html>
  return (
    <html
      lang="zh-CN"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <LocaleInitializer />
        {children}
      </body>
    </html>
  );
}
