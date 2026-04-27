import type { Metadata } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";
import Sidebar, { SidebarProvider } from "@/components/Sidebar";
import FloatingAIButton from "@/components/FloatingAIButton";
import { ThemeProvider } from "@/components/ThemeProvider";
import { SidebarSpacer } from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "Synap",
  description: "共享题库，支持文本和图片上传",
  icons: {
    icon: "/favicon.png",
  },
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
  },
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
                <main className="pb-16 sm:pb-0">
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
