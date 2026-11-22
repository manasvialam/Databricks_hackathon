import type { MetadataRoute } from "next";

/** What "Add to Home Screen" uses: the name and the icons. iOS ignores the SVG icon, so the PNGs matter. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bharosa", short_name: "Bharosa", start_url: "/", display: "standalone", background_color: "#f3efe8", theme_color: "#102a43",
    icons: [{ src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" }],
  };
}
