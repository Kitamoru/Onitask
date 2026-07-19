import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { BottomMenu } from "@/components/shared/BottomMenu";
import { TelegramInit } from "@/components/shared/TelegramInit";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
    >
      <head>
        {/* Telegram WebApp SDK — required for window.Telegram.WebApp */}
        {/* NOTE: Do NOT use async/defer — must load BEFORE any React code executes */}
        <script src="https://telegram.org/js/telegram-web-app.js" />
      </head>
      <body className="min-h-full flex flex-col pb-[var(--size-bottom-menu-height)]">
        <TelegramInit />
        {children}
        <BottomMenu />
      </body>
    </html>
  );
}