/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}', './app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /* ==========================================
         BREAKPOINTS — Mobile-first with xs (480px)
         ========================================== */
      screens: {
        xs: '480px',   // Small mobile (iPhone SE, etc.)
        sm: '640px',   // Large mobile / landscape
        md: '768px',   // Tablet
        lg: '1024px',  // Desktop
        xl: '1280px',  // Large desktop
      },

      /* ==========================================
         COLORS — mapped to CSS custom properties
         All hex values are centralized in src/styles/tokens.css
         
         Telegram Theme Variables优先于设计令牌:
         - --tg-theme-bg-color → фон основного контента
         - --tg-theme-text-color → основной текст
         - --tg-theme-button-color → цвет кнопок
         - --tg-theme-button-text-color → текст кнопок
         - --tg-theme-secondary-bg-color → вторичный фон (поверх основного)
         - --tg-theme-hint-color → подсказки/плейсхолдеры
         ========================================== */
      colors: {
        // Backgrounds — с приоритетом Telegram темы
        'primary-dark': 'var(--tg-theme-bg-color, var(--color-bg-primary-dark))',
        'bg-dark': 'var(--tg-theme-bg-color, var(--color-bg-primary-dark))',
        'surface': 'var(--tg-theme-secondary-bg-color, var(--tg-theme-section-bg-color, var(--color-bg-surface)))',
        'surface-hover': 'var(--color-bg-surface-hover)',
        'bg-light': 'var(--color-bg-light)',

        // Text — с приоритетом Telegram темы
        'text-primary': 'var(--tg-theme-text-color, var(--color-text-primary))',
        'text-muted': 'var(--tg-theme-hint-color, var(--color-text-muted))',
        'text-secondary': 'var(--tg-theme-section-header-text-color, var(--color-text-secondary))',
        'text-subtle': 'var(--tg-theme-subtitle-text-color, var(--color-text-muted))',

        // Accent — с приоритетом Telegram кнопки
        'accent-amber': 'var(--tg-theme-button-color, var(--color-accent-amber))',
        'accent-amber-subtle': 'var(--color-accent-amber-subtle)',
        'accent-button-text': 'var(--tg-theme-button-text-color, var(--color-text-white))',

        // Error — destructive action color
        'error': 'var(--tg-theme-destructive-text-color, var(--color-error))',

        // Signal — system colors (не зависят от темы Telegram)
        'signal-yellow': 'var(--color-signal-yellow)',
        'signal-red': 'var(--color-signal-red)',
        'signal-green': 'var(--color-signal-green)',
        'signal-cyan': 'var(--color-signal-cyan)',

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
         + Safe area insets for notched devices
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
        // Safe area insets (env() fallback to 0)
        'safe-top': 'max(0px, env(safe-area-inset-top, 0px))',
        'safe-bottom': 'max(0px, env(safe-area-inset-bottom, 0px))',
        'safe-left': 'max(0px, env(safe-area-inset-left, 0px))',
        'safe-right': 'max(0px, env(safe-area-inset-right, 0px))',
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

      /* ==========================================
         MIN HEIGHT — dynamic viewport for mobile
         ========================================== */
      minHeight: {
        'screen-dvh': '100dvh',
        'screen-svh': '100svh',
        'screen-vh': '100vh',
      },

      /* ==========================================
         MAX WIDTH — mobile container constraints
         ========================================== */
      maxWidth: {
        'mobile': '480px',     // Max width for small mobile
        'mobile-sm': '390px',   // iPhone 14 Pro max width
        'form': 'var(--spacing-form-max-width)', // 358px form width
      },

      /* ==========================================
         Z-INDEX — layer ordering
         ========================================== */
      zIndex: {
        'modal': '100',
        'toast': '90',
        'bottom-menu': '50',
      },
    },
  },
  plugins: [],
};
