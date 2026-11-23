import { ImageResponse } from "next/og";

// Icône d'écran d'accueil iPhone (Safari n'accepte pas le SVG ici)
export const dynamic = "force-static";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: "#0f3b2e", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="140" height="140" viewBox="0 0 64 64">
          <path d="M12 30h40c0 11-9 20-20 20S12 41 12 30z" fill="#e8462f" />
          <rect x="8" y="27" width="48" height="5" rx="2.5" fill="#f7c948" />
          <path d="M24 22c0-4 4-4 4-8M34 22c0-4 4-4 4-8" stroke="#eef2ec" strokeWidth="3" fill="none" strokeLinecap="round" />
        </svg>
      </div>
    ),
    size,
  );
}
