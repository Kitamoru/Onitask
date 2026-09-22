import type { Viewport, Metadata } from "next";
import { Geist_Mono } from "next/font/google";
// PERF-01: self-hosted Inter (variable, оси wght+opsz) вместо блокирующего
// стороннего @import Google Fonts. Файлы отдаются с того же origin → immutable-кэш
// и никакого внешнего CSS на критическом пути первого рендера.
import "@fontsource-variable/inter/opsz.css";
import "./globals.css";
import Script from "next/script";
import { AiTaskCreator } from "@/components/shared/AiTaskCreator";
import { TelegramThemeProvider } from "@/components/shared/TelegramThemeProvider";
import { TelegramProvider } from "@/components/shared/TelegramProvider";
import { AuthLoader } from "@/components/shared/AuthLoader";
import { DataProvider } from "@/contexts/DataContext";
import { TelegramDeepLinkRouter } from "./TelegramDeepLinkRouter";
import { QueryProviders } from "./providers";

// PERF-01: Geist Sans убран. UI-шрифт — Inter (--font-family-base), класс
// font-sans/font-geist-sans в разметке не используется, значит preload этих
// woff2 только тратил критический путь. Geist Mono оставлен (font-mono в UI).
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
  // Omnidesign: Onitask is dark-only by design; lock native browser controls
  // (scrollbars, inputs) to dark regardless of Telegram's light/dark theme.
  colorScheme: 'dark',
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
      className={`${geistMono.variable} h-full antialiased`}
      // Add tg-webapp class when running inside Telegram for CSS targeting
      suppressHydrationWarning
    >
      <head>
        {/* PERF-03: без preconnect браузер платит DNS+TLS до telegram.org
            синхронно на пути загрузки SDK. Viewport задан через
            `export const viewport` выше — дублирующий <meta> убран. */}
        <link rel="preconnect" href="https://telegram.org" crossOrigin="anonymous" />
      </head>
      {/* PERF-03: SDK грузится afterInteractive — не блокирует рендер и гидратацию.
          Готовность SDK/initData теперь ожидается явно (waitForInitData в
          useTelegramAuth), поэтому гонки «SDK ещё не загрузился, а хук уже читает
          window.Telegram» больше нет (она давала ложный экран not_in_twa). */}
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="afterInteractive"
      />
      <body className="flex flex-col bg-primary-dark text-text-primary min-h-dvh">
        <QueryProviders>
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
        </QueryProviders>
      </body>
    </html>
  );
}
