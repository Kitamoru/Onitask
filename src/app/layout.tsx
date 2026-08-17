import type { Viewport, Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Script from "next/script";
import { AiTaskCreator } from "@/components/shared/AiTaskCreator";
import { TelegramThemeProvider } from "@/components/shared/TelegramThemeProvider";
import { TelegramProvider } from "@/components/shared/TelegramProvider";
import { AuthLoader } from "@/components/shared/AuthLoader";
import { DataProvider } from "@/contexts/DataContext";
import { TelegramDeepLinkRouter } from "./TelegramDeepLinkRouter";

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
        {/* Safe area viewport meta — required for env(safe-area-inset-*) on production */}
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      {/* Telegram WebApp SDK — loads before interactive to ensure window.Telegram.WebApp exists */}
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="beforeInteractive"
      />
        <body className="flex flex-col bg-primary-dark text-text-primary min-h-dvh">
          <TelegramProvider>
            <TelegramThemeProvider>
              <DataProvider>
                {/* Deep link router — монтируется СРАЗУ, не ждёт авторизацию.
                    Должен быть ВНУТРИ провайдеров (Telegram, Data), но ВНЕ AuthLoader. */}
                <TelegramDeepLinkRouter />
                
                <AuthLoader>
                  {children}
                </AuthLoader>
                
                <AiTaskCreator />
              </DataProvider>
            </TelegramThemeProvider>
          </TelegramProvider>
        </body>
    </html>
  );
}