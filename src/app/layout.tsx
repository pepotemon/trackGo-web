import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { InstallAppPrompt } from "@/components/pwa/InstallAppPrompt";
import { NoContextMenu } from "@/components/pwa/NoContextMenu";

// Render-blocking splash that runs before the browser paints anything.
// The element is appended to <html> (not <body>), so React never sees it
// and hydration is unaffected. Removed after ≥ 900ms + DOMContentLoaded.
const SPLASH_CSS = [
  "@keyframes tgs-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}",
  "@keyframes tgs-blip{0%{transform:scale(1);opacity:.85}18%{transform:scale(2.2);opacity:.35}30%,100%{transform:scale(3);opacity:0}}",
  "@keyframes tgs-ring{0%,100%{opacity:.55}50%{opacity:1}}",
  "@keyframes tgs-core{0%,100%{opacity:1}50%{opacity:.4}}",
  ".tgs-sweep{transform-origin:20px 20px;animation:tgs-spin 3s linear infinite}",
  ".tgs-r1{animation:tgs-ring 3.5s 0s ease-in-out infinite}",
  ".tgs-r2{animation:tgs-ring 3.5s 1.17s ease-in-out infinite}",
  ".tgs-r3{animation:tgs-ring 3.5s 2.33s ease-in-out infinite}",
  ".tgs-ba{transform-origin:29px 10px;animation:tgs-blip 3s .35s linear infinite}",
  ".tgs-bb{transform-origin:8px 13px;animation:tgs-blip 3s 2.5s linear infinite}",
  ".tgs-core{transform-origin:20px 20px;animation:tgs-core 1.5s ease-in-out infinite}",
  "@media(prefers-reduced-motion:reduce){.tgs-sweep,.tgs-r1,.tgs-r2,.tgs-r3,.tgs-ba,.tgs-bb,.tgs-core{animation:none!important}}",
].join("");

const SPLASH_SVG = [
  '<svg width="80" height="80" viewBox="0 0 40 40" fill="none">',
  "<defs>",
  '<radialGradient id="tgs-rf" cx="20" cy="20" r="18" gradientUnits="userSpaceOnUse">',
  '<stop offset="0%" stop-color="#8B5CF6" stop-opacity="0.45"/>',
  '<stop offset="100%" stop-color="#E879F9" stop-opacity="0.04"/>',
  "</radialGradient>",
  '<radialGradient id="tgs-cd" cx="50%" cy="50%" r="50%">',
  '<stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.95"/>',
  '<stop offset="100%" stop-color="#EC4899"/>',
  "</radialGradient>",
  "</defs>",
  // rings — wave-pulse
  '<circle class="tgs-r1" cx="20" cy="20" r="18" stroke="#A78BFA" stroke-width="0.75" stroke-opacity="0.4"/>',
  '<circle class="tgs-r2" cx="20" cy="20" r="13" stroke="#A78BFA" stroke-width="0.75" stroke-opacity="0.65"/>',
  '<circle class="tgs-r3" cx="20" cy="20" r="8" stroke="#C4B5FD" stroke-width="1" stroke-opacity="0.85"/>',
  // crosshair
  '<line x1="20" y1="2" x2="20" y2="38" stroke="#C4B5FD" stroke-width="0.4" stroke-opacity="0.2" stroke-dasharray="1.5 2.5"/>',
  '<line x1="2" y1="20" x2="38" y2="20" stroke="#C4B5FD" stroke-width="0.4" stroke-opacity="0.2" stroke-dasharray="1.5 2.5"/>',
  // sweep arm — rotates
  '<g class="tgs-sweep">',
  '<path d="M20 20 L20 2 A18 18 0 0 1 35.6 11 Z" fill="url(#tgs-rf)"/>',
  '<line x1="20" y1="20" x2="20" y2="2" stroke="#A78BFA" stroke-width="0.75" stroke-opacity="0.55"/>',
  '<line x1="20" y1="20" x2="35.6" y2="11" stroke="#F0ABFC" stroke-width="1.5" stroke-linecap="round"/>',
  "</g>",
  // secondary blip (≈42° from 12 o'clock)
  '<circle cx="29" cy="10" r="3.5" fill="#7C3AED" fill-opacity="0.2"/>',
  '<circle cx="29" cy="10" r="3.5" class="tgs-ba" fill="#C4B5FD"/>',
  '<circle cx="29" cy="10" r="2" fill="#C4B5FD"/>',
  // tertiary blip (≈300° from 12 o'clock)
  '<circle cx="8" cy="13" r="2.2" class="tgs-bb" fill="#A78BFA"/>',
  '<circle cx="8" cy="13" r="1.3" fill="#A78BFA" fill-opacity="0.7"/>',
  // center — heartbeat
  '<circle cx="20" cy="20" r="5.5" fill="#EC4899" fill-opacity="0.2"/>',
  '<circle cx="20" cy="20" r="3" fill="url(#tgs-cd)" class="tgs-core"/>',
  "</svg>",
].join("");

const SPLASH_WORDMARK = [
  '<div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;',
  "font-weight:900;font-size:28px;letter-spacing:-0.5px;color:#fff\">",
  "Track",
  '<span style="background:linear-gradient(to right,#C4B5FD,#F0ABFC);',
  "-webkit-background-clip:text;-webkit-text-fill-color:transparent;",
  'background-clip:text">Go</span>',
  "</div>",
].join("");

const SPLASH_SCRIPT = `(function(){
  var css=document.createElement('style');
  css.textContent='${SPLASH_CSS}';
  document.head.appendChild(css);

  var el=document.createElement('div');
  el.style.cssText='position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;background:linear-gradient(155deg,#1e0a3c 0%,#3b0d6b 55%,#5b21b6 100%);opacity:1;transition:opacity 0.4s ease';
  el.innerHTML='${SPLASH_SVG}${SPLASH_WORDMARK}';
  document.documentElement.appendChild(el);

  var min=false,dom=false;
  function go(){
    if(!min||!dom)return;
    el.style.opacity='0';
    el.style.pointerEvents='none';
    setTimeout(function(){if(el.parentNode)el.parentNode.removeChild(el);},440);
  }
  setTimeout(function(){min=true;go();},900);
  if(document.readyState==='interactive'||document.readyState==='complete'){dom=true;}
  else{document.addEventListener('DOMContentLoaded',function(){dom=true;go();},{once:true});}
})();`;

export const metadata: Metadata = {
  title: "TrackGo",
  applicationName: "TrackGo",
  description: "TrackGo",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "TrackGo",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/icons/trackgo-icon.svg", type: "image/svg+xml" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180" },
    ],
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-title": "TrackGo",
  },
};

export const viewport: Viewport = {
  themeColor: "#7c3aed",
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
    <html lang="es">
      <head>
        {/* Animated splash — runs before first paint, removed after ≥900ms */}
        <script dangerouslySetInnerHTML={{ __html: SPLASH_SCRIPT }} />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
        <InstallAppPrompt />
        <NoContextMenu />
      </body>
    </html>
  );
}
