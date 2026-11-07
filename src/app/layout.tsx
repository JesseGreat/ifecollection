import type { Metadata, Viewport } from "next";
import { RegisterServiceWorker } from "@/components/RegisterServiceWorker";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "IfeCollection", template: "%s · IfeCollection" },
  description: "IfeCollection sales and stock",
  applicationName: "IfeCollection",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "IfeCollection", statusBarStyle: "black-translucent" },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#861041",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-NG" className="h-full antialiased">
      <body className="min-h-full">
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
