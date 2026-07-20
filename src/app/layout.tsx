import type { Viewport, Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { BottomMenu } from "@/components/shared/BottomMenu";
import { TelegramInit } from "@/components/shared/TelegramInit";
import { TelegramThemeProvider } from "@/components/shared/TelegramTheme";
import { TelegramProvider } from "@/components/shared/TelegramProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: {
    default: 'Onitask — AI-Native Control Plane',
    template: '%s | Onitask',
  },
  description: 'Гибридное управление задачами для команд людей и AI-агентов',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // Add tg-webapp class when running inside Telegram for CSS targeting
      suppressHydrationWarning
    >
      <head>
        {/* Telegram WebApp SDK — required for window.Telegram.WebApp */}
        {/* NOTE: Do NOT use async/defer — must load BEFORE any React code executes */}
        <script src="https://telegram.org/js/telegram-web-app.js" />
        {/* Safe area viewport meta — required for env(safe-area-inset-*) on production */}
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body className="flex flex-col bg-primary-dark text-text-primary min-h-dvh">
        <TelegramProvider>
          <TelegramThemeProvider>
            <TelegramInit />
            {children}
            <BottomMenu />
          </TelegramThemeProvider>
        </TelegramProvider>
      </body>
    </html>
  );
}
