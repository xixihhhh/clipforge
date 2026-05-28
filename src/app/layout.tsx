import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import GlobalProviders from "@/components/GlobalProviders";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/* ------------------------------------------------------------------ */
/*  Viewport 配置 — 适配移动端                                          */
/* ------------------------------------------------------------------ */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

/* ------------------------------------------------------------------ */
/*  Metadata 配置 — SEO + favicon + og:image                           */
/* ------------------------------------------------------------------ */
export const metadata: Metadata = {
  title: "带货剪手 - 电商带货短视频 AI 生成",
  description: "上传商品图，AI 生成脚本，一键生成带货短视频",
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/favicon.ico",
  },
  openGraph: {
    title: "带货剪手 - 电商带货短视频 AI 生成",
    description: "上传商品图，AI 生成脚本，一键生成带货短视频",
    type: "website",
    locale: "zh_CN",
    siteName: "带货剪手",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "带货剪手 - 电商带货短视频 AI 生成",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "带货剪手 - 电商带货短视频 AI 生成",
    description: "上传商品图，AI 生成脚本，一键生成带货短视频",
    images: ["/og-image.png"],
  },
};

/* ------------------------------------------------------------------ */
/*  Root Layout                                                        */
/* ------------------------------------------------------------------ */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <GlobalProviders>{children}</GlobalProviders>
      </body>
    </html>
  );
}
