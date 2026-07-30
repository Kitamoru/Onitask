/** @type {import('tailwindcss').Config} */
module.exports = {
  // v3 has no automatic content detection (that's a v4-only feature) —
  // every path Tailwind should scan for class names must be listed
  // explicitly. Anything not matched here silently gets its classes
  // purged from the production build, so keep this in sync with where
  // components actually live.
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      // Same tokens as the old @theme block, just re-homed: the actual
      // values still live as CSS custom properties in styles/globals.css
      // (:root block) — this just wires Tailwind's utility generator to
      // read from them, so `bg-accent`, `text-text-muted`, `border-line`
      // etc. compile exactly like they did under v4.
      colors: {
        bg: "var(--color-bg)",
        surface: "var(--color-surface)",
        "surface-raised": "var(--color-surface-raised)",
        line: "var(--color-line)",
        "line-strong": "var(--color-line-strong)",
        accent: "var(--color-accent)",
        "accent-strong": "var(--color-accent-strong)",
        "accent-ink": "var(--color-accent-ink)",
        text: "var(--color-text)",
        "text-muted": "var(--color-text-muted)",
        "text-faint": "var(--color-text-faint)",
        "toggle-track-off": "var(--color-toggle-track-off)",
        "toggle-knob": "var(--color-toggle-knob)",
        success: "var(--color-success)",
        "progress-track": "var(--color-progress-track)",
        scrim: "var(--color-scrim)",
      },
      borderRadius: {
        card: "var(--radius-card)",
        field: "var(--radius-field)",
        pill: "var(--radius-pill)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "Inter Display",
          "SF Pro Text",
          "Segoe UI",
          "system-ui",
          "-apple-system",
          "Helvetica Neue",
          "Roboto",
          "sans-serif",
        ],
      },
      spacing: {
        "section-gap": "var(--spacing-section-gap)",
        "page-gutter": "var(--spacing-page-gutter)",
      },
    },
  },
  plugins: [],
};
