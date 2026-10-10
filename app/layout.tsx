import type { Metadata, Viewport } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";
import UIChrome from "@/components/UIChrome";
import { ThemeProvider } from "@/components/ThemeProvider";

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
    // data-ui drives the glass token layer in globals.css; UIChrome keeps it in sync
    // with the remembered choice. It defaults to the new shell so nothing flashes.
    <html lang="zh-CN" data-ui="glass">
      <body className="bg-gray-50 text-gray-900">
        <ThemeProvider>
          <UIChrome>{children}</UIChrome>
        </ThemeProvider>
      </body>
    </html>
  );
}
