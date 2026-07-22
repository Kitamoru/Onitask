import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      screens: {
        xs: "480px",
        sm: "640px",
        md: "768px",
        lg: "1024px",
        xl: "1280px",
      },
      colors: {
        // Base background colors (used directly via CSS variables)
        "primary-dark": "var(--tg-theme-bg-color, var(--color-bg-primary-dark, #0A0A0A))",
        "bg": "var(--color-bg, #0a0a0a)",
        "bg-dark": "var(--tg-theme-bg-color, var(--color-bg-primary-dark, #0A0A0A))",
        surface: "var(--tg-theme-secondary-bg-color, var(--tg-theme-section-bg-color, var(--color-surface, #101010)))",
        "surface-hover": "var(--color-bg-surface-hover, #2A2A2A)",
        "bg-light": "var(--color-bg-light, #FAFAFA)",

        // Text
        "text-primary": "var(--tg-theme-text-color, var(--color-text-primary, #FAFAFA))",
        text: "var(--tg-theme-text-color, var(--color-text-primary, #FAFAFA))",
        "text-muted": "var(--tg-theme-hint-color, var(--color-text-muted, #8B8B8B))",
        "text-faint": "var(--tg-theme-hint-color, var(--color-text-muted, #8B8B8B))",
        "text-secondary": "var(--tg-theme-section-header-text-color, var(--color-text-secondary, #808080))",
        "text-subtle": "var(--tg-theme-subtitle-text-color, var(--color-text-muted, #8B8B8B))",

        // Accent
        "accent-amber": "var(--tg-theme-button-color, var(--color-accent-amber, #ff9900))",
        accent: "var(--tg-theme-button-color, var(--color-accent-amber, #ff9900))",
        "accent-amber-subtle": "var(--color-accent-amber-subtle, rgba(255, 153, 0, 0.1))",
        "accent-ink": "#0A0A0A",
        "accent-button-text": "var(--tg-theme-button-text-color, var(--color-text-white, #FFFFFF))",

        // Error
        error: "var(--tg-theme-destructive-text-color, var(--color-error, #EF4444))",

        // Signal colors
        "signal-yellow": "var(--color-signal-yellow, #F59E0B)",
        "signal-red": "var(--color-signal-red, #EF4444)",
        "signal-green": "var(--color-signal-green, #4ADE80)",
        "signal-cyan": "var(--color-signal-cyan, #22D3EE)",

        // Border
        "border-default": "var(--color-border-default, rgba(139, 139, 139, 0.2))",
        "border-white-subtle": "var(--color-border-white-subtle, rgba(255, 255, 255, 0.1))",
        line: "var(--color-border-default, rgba(139, 139, 139, 0.2))",

        // Toggle
        "toggle-track-off": "#101010",
        "toggle-knob": "#FAFAFA",

        // Gradients
        "grad-add-from": "var(--color-grad-add-from, #6a8a72)",
        "grad-add-to": "var(--color-grad-add-to, #a9915a)",
        "grad-warning-from": "var(--color-grad-warning-from, #ffb547)",
        "grad-warning-to": "var(--color-grad-warning-to, #6e3f00)",
        "grad-urgent-from": "var(--color-grad-urgent-from, #d9636b)",
        "grad-urgent-to": "var(--color-grad-urgent-to, #55151a)",

        // System
        background: "var(--background, #ffffff)",
        foreground: "var(--foreground, #171717)",
        "gray-custom-30": "rgba(139, 139, 139, 0.3)",
        "ring-accent-amber": "var(--color-accent-amber, #ff9900)",
      },
      fontFamily: {
        base: ["Inter", "system-ui", "sans-serif"],
        display: ["Inter Display", "system-ui", "sans-serif"],
        inter: ["Inter", "system-ui", "sans-serif"],
        "inter-display": ["Inter Display", "system-ui", "sans-serif"],
        sans: ["var(--font-geist-sans)", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
      },
      fontSize: {
        "heading-sm": ["clamp(0.875rem, 1vw, 0.875rem)", { lineHeight: "1.125" }],
        "heading-md": ["clamp(1rem, 1.2vw, 1rem)", { lineHeight: "1.25" }],
        "body-xs": ["clamp(0.6875rem, 0.8vw, 0.6875rem)", { lineHeight: "1.364" }],
        "body-sm": ["clamp(0.75rem, 0.9vw, 0.75rem)", { lineHeight: "1.167" }],
        "body-md": ["clamp(0.875rem, 1vw, 0.875rem)", { lineHeight: "1.286" }],
        "body-lg": ["clamp(1rem, 1.2vw, 1rem)", { lineHeight: "1.25" }],
        "body-xl": ["clamp(1rem, 1.2vw, 1rem)", { lineHeight: "1.25" }],
      },
      borderRadius: {
        none: "0",
        xs: "0.0625rem",
        sm: "0.25rem",
        "input-sm": "0.25rem",
        md: "0.375rem",
        card: "0.5rem",
        DEFAULT: "0.5rem",
        lg: "0.375rem",
        full: "9999px",
        field: "16px",
        notch: "16px",
      },
      spacing: {
        "0": "0",
        "0.5": "0.125rem",
        "1": "0.25rem",
        "1.5": "0.375rem",
        "2": "0.5rem",
        "2.5": "0.625rem",
        "3": "0.75rem",
        "3.5": "0.875rem",
        "4": "1rem",
        "5": "1.25rem",
        "6": "1.5rem",
        "8": "2rem",
        "16": "4rem",
        "section-gap": "32px",
        "page-gutter": "16px",
      },
      maxWidth: {
        mobile: "480px",
        "mobile-sm": "390px",
        form: "22.375rem",
      },
      zIndex: {
        modal: "100",
        toast: "90",
        "bottom-menu": "50",
        50: "50",
      },
      transitionDuration: {
        fast: "150ms",
        normal: "200ms",
        slow: "300ms",
      },
      letterSpacing: {
        tight: "-0.0313em",
        tighter: "-0.0357em",
        tightest: "-0.0417em",
      },
      opacity: {
        "20": "0.2",
        "40": "0.4",
        "50": "0.5",
      },
      // Custom utilities via plugins
    },
  },
  plugins: [],
};

export default config;