import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Popote",
    short_name: "Popote",
    description: "Courses, placard et repas de la semaine, en famille.",
    start_url: "/",
    display: "standalone",
    background_color: "#eef2ec",
    theme_color: "#0f3b2e",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
