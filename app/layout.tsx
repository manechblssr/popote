import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, Bricolage_Grotesque } from "next/font/google";
import "./globals.css";

const body = Atkinson_Hyperlegible({ subsets: ["latin"], weight: ["400", "700"], variable: "--f-body" });
const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["500", "700", "800"], variable: "--f-display" });

export const metadata: Metadata = {
  title: "Popote",
  description: "Courses, placard et repas de la semaine, en famille.",
  appleWebApp: { capable: true, title: "Popote", statusBarStyle: "default" },
};
export const viewport: Viewport = { themeColor: "#0f3b2e", width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: "cover" };

/** Safari iOS ignore user-scalable=no : on bloque le pincement à la main. */
const NO_ZOOM = `(function(){var s=function(e){e.preventDefault()};["gesturestart","gesturechange","gestureend"].forEach(function(t){document.addEventListener(t,s,{passive:false})});document.addEventListener("touchmove",function(e){if(e.touches.length>1)e.preventDefault()},{passive:false})})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${body.variable} ${display.variable}`}>
      <body>
        <script dangerouslySetInnerHTML={{ __html: NO_ZOOM }} />
        {children}
      </body>
    </html>
  );
}
