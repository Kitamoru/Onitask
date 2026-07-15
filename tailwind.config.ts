/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}', './app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        dark: '#0A0A0A',
        light: '#FAFAFA',
        yellow: '#F59E0B',
        grayCustom: '#8B8B8B',
        grayLight: '#808080',
        darkBg: '#101010',
        // Board form colors (used in src/components/board/)
        'primary-dark': '#0A0A0A',
        'bg-light': '#FAFAFA',
        'text-muted': '#8B8B8B',
        surface: '#1A1A1A',
        'accent-amber': '#F59E0B',
      },
      fontFamily: {
        inter: ['Inter', 'sans-serif'],
        'inter-display': ['Inter Display', 'sans-serif'],
      },
      borderRadius: {
        card: '8px',
        'input-sm': '4px',
      },
    },
  },
  plugins: [],
};
