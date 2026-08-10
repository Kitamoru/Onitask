'use client';

/**
 * Segments — segmented control (Figma "segments" 441:48462).
 *
 * Used in task-create wizard to switch between "Поэтапно" and "Всё сразу".
 * Selected segment has dark fill (#202020), unselected is transparent with muted text.
 */

export interface SegmentOption<T extends string = string> {
  value: T;
  label: string;
}

export function Segments<T extends string = string>({
  options,
  value,
  onChange,
  disabled = false,
  className = '',
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label="Режим создания"
      className={`flex w-full items-center gap-0 rounded-[4px] border p-[2px] ${className}`}
      style={{
        backgroundColor: '#101010',
        borderColor: 'rgba(255, 255, 255, 0.2)',
        borderWidth: 1,
      }}
    >
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className="flex flex-1 items-center justify-center gap-2 rounded-[2px] px-1.5 py-0.5 transition-colors"
            style={{
              backgroundColor: isActive ? '#202020' : 'transparent',
              color: isActive ? '#FAFAFA' : '#8B8B8B',
              fontFamily: 'var(--font-family-display)',
              fontSize: 'var(--text-body-sm)',
              lineHeight: '18px',
              fontWeight: 'var(--font-weight-medium)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.6 : 1,
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}