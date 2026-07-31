/**
 * Example only — merge into your existing app/layout.tsx, don't drop this
 * file in verbatim if you already have a root layout with providers etc.
 *
 * IMPORTANT FIX: this file was previously marked "use client" at the top
 * level, which silently breaks Next.js's `viewport`/`metadata` exports —
 * Next.js only reads those from Server Components and errors (or in some
 * setups just ignores them) if the layout itself is a Client Component.
 * That also meant there was NO viewport meta tag being emitted at all —
 * without it, mobile browsers (and Telegram's in-app WebView) fall back
 * to a desktop-width viewport (~980px) and scale the whole page down to
 * fit, which is almost certainly why the page "плохо масштабируется" —
 * looks zoomed-out/mis-scaled instead of laying out natively at the
 * device's real width. Fix: keep the root layout a Server Component,
 * export `viewport` from it, and push the one thing that actually needs
 * the browser (`useTelegramViewport`) into its own small Client Component
 * mounted as a child — same pattern as before, just no longer poisoning
 * the whole layout with "use client".
 */
import type { Viewport } from "next";
import "@/styles/globals.css";
import { TelegramViewportBridge } from "@/components/TelegramViewportBridge";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1, // TWA forms feel more native without pinch-zoom fighting
  // Required for env(safe-area-inset-*) to return real, non-zero values
  // on notched/Dynamic-Island iPhones — without viewport-fit=cover every
  // safe-area env() var silently resolves to 0, which is a second,
  // independent reason content can end up under the notch or under
  // Telegram's own header chrome.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <head>
        {/* Load before hydration so WebApp.expand()/ready() fire as early
            as possible — a late expand() is the most common cause of a
            visible layout jump on TWA cold start. */}
        <script src="https://telegram.org/js/telegram-web-app.js" />
      </head>
      <body className="bg-bg text-text">
        <TelegramViewportBridge />
        {children}
      </body>
    </html>
  );
}
