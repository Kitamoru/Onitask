// Standard Next.js + Tailwind v3 PostCSS pipeline. No cssnano here on
// purpose — Next.js's own production build already minifies CSS output
// (bundled cssnano-simple preset), adding it here would just re-run
// minification a second time for no benefit. See README "PurgeCSS /
// bundle size" section for the full breakdown of what's automatic vs
// what you'd add by hand outside Next.js.
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
