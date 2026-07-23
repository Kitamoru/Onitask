export function SectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      {/* measured ~2px wide x 18px tall on the reference — thinner than
          a typical 4px marker bar */}
      <span className="h-[18px] w-0.5 rounded-full bg-accent" aria-hidden />
      <h2 className="text-[17px] font-medium text-text">{title}</h2>
    </div>
  );
}
