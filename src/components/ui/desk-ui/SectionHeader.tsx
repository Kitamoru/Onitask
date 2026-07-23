export function SectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span
        className="h-[18px] w-0.5 rounded-full"
        style={{ backgroundColor: "#ff9900" }}
        aria-hidden
      />
      <h2 className="text-[17px] font-medium text-text">{title}</h2>
    </div>
  );
}
