"use client";

import { CreateDeskForm } from "@/components/desk-create/CreateDeskForm";
import type { CreateDeskFormValue } from "@/components/desk-create/CreateDeskForm";

/**
 * Drop this in as the route component, e.g.
 *   app/(desk)/create/page.tsx  →  export { CreateDeskPage as default }
 *
 * Mount `useTelegramViewport()` once in the root layout (app/layout.tsx),
 * not here — it writes to :root and only needs to run once per session.
 * See hooks/useTelegramViewport.ts.
 */
export function CreateDeskPage() {
  const handleSubmit = (value: CreateDeskFormValue) => {
    // wire to your onitask create-workspace mutation here
    console.log("create desk", value);
  };

  return (
    <main
      className="min-h-[var(--tg-viewport-stable-height)] bg-bg"
      style={{
        // Telegram's own chrome (back button / chat title / "..." menu,
        // or the collapsed Main Button slot) sits on top of the OS safe
        // area. `--tg-content-safe-top` covers that dynamically via the
        // WebApp API, but it isn't reliable on every client version (and
        // is simply 0 before the JS bridge has run on first paint) — so
        // this is a *floor*, not a replacement: whichever is bigger wins.
        // 48px was picked to clear Telegram's standard header row; bump
        // it if your bot's header ends up taller.
        paddingTop: "max(48px, var(--tg-content-safe-top))",
        // At the bottom we stack the OS home-indicator inset *under*
        // Telegram's chrome so the last card / CTA never sits flush
        // against either.
        paddingBottom:
          "calc(var(--tg-content-safe-bottom) + var(--tg-safe-area-bottom))",
      }}
    >
      <CreateDeskForm
        onSubmit={handleSubmit}
        onAddColleague={() => console.log("add colleague")}
      />
    </main>
  );
}
