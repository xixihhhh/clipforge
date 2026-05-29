import type { Metadata, Viewport } from "next";
// 使用系统字体栈，避免构建时网络问题
import GlobalProviders from "@/components/GlobalProviders";
import MobileNav from "@/components/MobileNav";
import MobileLayout from "@/components/MobileLayout";
import "./globals.css";

const geistSans = {
  variable: "--font-geist-sans",
};

const geistMono = {
  variable: "--font-geist-mono",
};

/* ------------------------------------------------------------------ */
/*  Viewport 配置 — 适配移动端 PWA                                     */
/* ------------------------------------------------------------------ */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

/* ------------------------------------------------------------------ */
/*  Metadata 配置 — SEO + PWA + og:image                               */
/* ------------------------------------------------------------------ */
export const metadata: Metadata = {
  title: "萌萌的 - 电商带货短视频 AI 生成",
  description: "上传商品图，AI 生成脚本，一键生成带货短视频",
  icons: {
    icon: "/icons/favicon.png",
    shortcut: "/icons/favicon.png",
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "萌萌的",
  },
  manifest: "/manifest.json",
  openGraph: {
    title: "萌萌的 - 电商带货短视频 AI 生成",
    description: "上传商品图，AI 生成脚本，一键生成带货短视频",
    type: "website",
    locale: "zh_CN",
    siteName: "萌萌的",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "萌萌的 - 电商带货短视频 AI 生成",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "萌萌的 - 电商带货短视频 AI 生成",
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
        <GlobalProviders>
          <MobileLayout>{children}</MobileLayout>
        </GlobalProviders>
        <MobileNav />
      </body>
    </html>
  );
}
