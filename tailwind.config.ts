/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}', './app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /* ==========================================
         COLORS — mapped to CSS custom properties
         All hex values are centralized in src/styles/tokens.css
         ========================================== */
      colors: {
        // Backgrounds
        'primary-dark': 'var(--color-bg-primary-dark)',
        'bg-dark': 'var(--color-bg-dark)',
        'surface': 'var(--color-bg-surface)',
        'surface-hover': 'var(--color-bg-surface-hover)',
        'bg-light': 'var(--color-bg-light)',

        // Text
        'text-primary': 'var(--color-text-primary)',
        'text-muted': 'var(--color-text-muted)',
        'text-secondary': 'var(--color-text-secondary)',

        // Accent
        'accent-amber': 'var(--color-accent-amber)',
        'accent-amber-subtle': 'var(--color-accent-amber-subtle)',

        // Error
        'error': 'var(--color-error)',

        // Signal
        'signal-yellow': 'var(--color-signal-yellow)',
        'signal-red': 'var(--color-signal-red)',

        // Border
        'border-default': 'var(--color-border-default)',
        'border-white-subtle': 'var(--color-border-white-subtle)',
      },

      /* ==========================================
         FONT FAMILIES
         ========================================== */
      fontFamily: {
        base: ['var(--font-family-base)'],
        display: ['var(--font-family-display)'],
        inter: ['Inter', 'system-ui', 'sans-serif'],
        'inter-display': ['Inter Display', 'system-ui', 'sans-serif'],
      },

      /* ==========================================
         BORDER RADIUS — mapped to token variables
         ========================================== */
      borderRadius: {
        none: 'var(--radius-none)',
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        'input-sm': 'var(--radius-sm)',
        md: 'var(--radius-md)',
        card: 'var(--radius-card)',
        default: 'var(--radius-card)',
        lg: 'var(--radius-md)',
        full: '9999px',
      },

      /* ==========================================
         SPACING — all based on 4px grid, in rem
         ========================================== */
      spacing: {
        '0': 'var(--spacing-0)',
        '0.5': 'var(--spacing-0.5)',
        '1': 'var(--spacing-1)',
        '1.5': 'var(--spacing-1.5)',
        '2': 'var(--spacing-2)',
        '2.5': 'var(--spacing-2.5)',
        '3': 'var(--spacing-3)',
        '4': 'var(--spacing-4)',
        '5': 'var(--spacing-5)',
        '6': 'var(--spacing-6)',
        '8': 'var(--spacing-8)',
        '16': 'var(--spacing-16)',
      },

      /* ==========================================
         FONT SIZES — responsive with clamp()
         ========================================== */
      fontSize: {
        // [fontSize, lineHeight]
        'heading-sm': ['var(--text-heading-sm)', { lineHeight: 'var(--text-heading-sm-line)', fontWeight: 'var(--font-weight-medium)' }],
        'heading-md': ['var(--text-heading-md)', { lineHeight: 'var(--text-heading-md-line)', fontWeight: 'var(--font-weight-medium)' }],
        'body-xs': ['var(--text-body-xs)', { lineHeight: 'var(--text-body-xs-line)', fontWeight: 'var(--font-weight-regular)' }],
        'body-sm': ['var(--text-body-sm)', { lineHeight: 'var(--text-body-sm-line)', fontWeight: 'var(--font-weight-medium)' }],
        'body-md': ['var(--text-body-md)', { lineHeight: 'var(--text-body-md-line)', fontWeight: 'var(--font-weight-medium)' }],
        'body-lg': ['var(--text-body-lg)', { lineHeight: 'var(--text-body-lg-line)', fontWeight: 'var(--font-weight-regular)' }],
        'body-xl': ['var(--text-body-xl)', { lineHeight: 'var(--text-body-xl-line)', fontWeight: 'var(--font-weight-medium)' }],
      },

      /* ==========================================
         LETTER SPACING
         ========================================== */
      letterSpacing: {
        tight: 'var(--letter-spacing-tight)',
        tighter: 'var(--letter-spacing-tighter)',
        tightest: 'var(--letter-spacing-tightest)',
      },

      /* ==========================================
         TRANSITIONS
         ========================================== */
      transitionDuration: {
        'fast': 'var(--transition-fast)',
        'normal': 'var(--transition-normal)',
      },
    },
  },
  plugins: [],
};
