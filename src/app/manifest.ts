import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "IfeCollection",
    short_name: "IfeCollection",
    description: "IfeCollection sales and stock",
    start_url: "/",
    scope: "/",
    // Full-screen app look (no browser bars). "fullscreen" also hides the phone's status bar where supported;
    // "standalone" is the fallback.
    display: "fullscreen",
    display_override: ["fullscreen", "standalone"],
    orientation: "portrait",
    // background_color + name + 512px icon = the Android splash screen.
    background_color: "#861041",
    theme_color: "#861041",
    categories: ["business", "shopping"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
