import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Wisconsin Creative",
    short_name: "Creative",
    description: "Equipment checkout, reservation, and scan tracking for university athletics",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0f1117",
    theme_color: "#A00000",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
