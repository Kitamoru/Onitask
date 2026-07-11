// app/layout.tsx
// Root layout for the Next.js App Router.
// This placeholder includes a basic HTML structure.
import React from "react";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head />
      <body>{children}</body>
    </html>
  );
}
