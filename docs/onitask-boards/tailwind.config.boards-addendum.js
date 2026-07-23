/**
 * Merge into the existing theme.extend.colors object in tailwind.config.js
 * (alongside bg/surface/line/accent/text/etc.) so `bg-card` and
 * `text-danger` resolve like every other token on the page.
 */
{
  card: "var(--color-card)",
  danger: "var(--color-danger)",
}
