/**
 * Note on the reference mockup (IMG_6732): the bar's visible fill there
 * measured out to roughly 15% of the track width, while the label next
 * to it said "61%" — the two didn't actually match in the source. Since
 * this is a live number that changes sprint to sprint anyway, the
 * correct fix isn't to match either specific pixel width but to drive
 * the fill purely from the real `percent` prop, which is what this does.
 */
export function ProgressBar({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div
      className="h-1 w-full overflow-hidden rounded-pill bg-progress-track"
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-pill bg-success transition-all duration-300"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
