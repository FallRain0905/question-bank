import type { Metadata, Viewport } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";
import Sidebar, { SidebarProvider } from "@/components/Sidebar";
import FloatingAIButton from "@/components/FloatingAIButton";
import { ThemeProvider } from "@/components/ThemeProvider";
import { SidebarSpacer } from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "SynapFlow",
  description: "为学习和研究打造的辅助平台",
  icons: {
    icon: "/favicon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="bg-gray-50 text-gray-900">
        <ThemeProvider>
          <SidebarProvider>
            <div className="flex min-h-screen">
              <Sidebar />
              <SidebarSpacer>
                <main className="min-h-screen pb-24 lg:pb-0">
                  {children}
                </main>
              </SidebarSpacer>
            </div>
          </SidebarProvider>
          <FloatingAIButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
