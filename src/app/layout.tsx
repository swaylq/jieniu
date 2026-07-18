import "~/styles/globals.css";

import { type Metadata, type Viewport } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";

import { TRPCReactProvider } from "~/trpc/react";
import { auth } from "~/server/auth";
import { TabBar } from "./_components/tab-bar";
import { NotificationBell } from "./_components/notification-bell";
import { ThemeToggle } from "./_components/theme-toggle";
import { ColorblindToggle } from "./_components/colorblind-toggle";
import { Sidebar } from "./_components/sidebar";
import { CommandPaletteProvider } from "./_components/command-palette";
import { Logo } from "./_components/logo";
import { AskJieniu } from "./_components/ask-jieniu";
import {
  SITE_URL,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_DESCRIPTION,
  SITE_KEYWORDS,
  openGraph,
  twitter,
  websiteJsonLd,
  organizationJsonLd,
  jsonLdScript,
} from "~/lib/seo";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} · ${SITE_TAGLINE}`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: SITE_KEYWORDS,
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: "finance",
  alternates: { canonical: "/" },
  formatDetection: { telephone: false, email: false, address: false },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, statusBarStyle: "default", title: SITE_NAME },
  openGraph: openGraph(),
  twitter: twitter(),
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export const viewport: Viewport = {
  themeColor: "#0b1220",
  // 让 env(safe-area-inset-*) 生效——刘海屏 / 底部 home 指示条不遮挡内容
  viewportFit: "cover",
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

// 首帧无闪烁：在 hydration 前按 localStorage / 系统偏好给 <html> 加 .dark
const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}if(localStorage.getItem('cb')==='1'){document.documentElement.classList.add('cb');}}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();

  return (
    <html lang="zh-CN" className={geist.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <script {...jsonLdScript(websiteJsonLd())} />
        <script {...jsonLdScript(organizationJsonLd())} />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:border focus:border-line focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow-lg"
        >
          跳到主内容
        </a>
        <TRPCReactProvider>
          <CommandPaletteProvider>
            <div className="flex min-h-screen w-full">
              <Sidebar
                loggedIn={!!session?.user}
                email={session?.user?.email ?? null}
              />
              <div className="flex min-w-0 flex-1 flex-col">
              <header className="sticky top-0 z-30 flex min-h-14 items-center justify-between border-b border-line bg-surface/85 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-lg md:hidden">
                <Link href="/" aria-label="解牛首页">
                  <Logo />
                </Link>
                <div className="flex items-center gap-3">
                  <ColorblindToggle />
                  <ThemeToggle />
                  {session?.user ? (
                    <NotificationBell />
                  ) : (
                    <Link
                      href="/login"
                      className="rounded-full bg-[#0b0d12] px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-black dark:bg-white dark:text-[#0b0d12] dark:hover:bg-gray-200"
                    >
                      登录
                    </Link>
                  )}
                </div>
              </header>
              <div
                id="main-content"
                tabIndex={-1}
                className="flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] focus:outline-none md:pb-0"
              >
                {children}
              </div>
              <TabBar />
              </div>
            </div>
            {session?.user ? <AskJieniu /> : null}
          </CommandPaletteProvider>
        </TRPCReactProvider>
      </body>
    </html>
  );
}
