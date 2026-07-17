// app/layout.tsx
// Root layout for the Next.js App Router.
import React from "react";
import "./globals.css";
import { BottomMenu } from "@/components/shared/BottomMenu";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head />
      <body className="min-h-screen flex flex-col pb-[var(--size-bottom-menu-height)]">
        {children}
        <BottomMenu />
      </body>
    </html>
  );
}
