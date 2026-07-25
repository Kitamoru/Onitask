"use client";

import { SectionHeader } from "@/components/ui/desk-ui/SectionHeader";
import { TextArea } from "@/components/ui/desk-ui/TextArea";

const MAX_LENGTH = 1200;

export function ContextSection({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <section>
      <SectionHeader title="Контекст доски" />
      <TextArea
        corner="panel"
        value={value}
        onChange={onChange}
        placeholder="Краткое описание"
        maxLength={MAX_LENGTH}
        disabled={disabled}
      />
      {/* Subtle, not a copied-from-Documents pill badge on purpose — this
          field has no existing hint line in the reference mockup, so a
          small muted counter (rather than inventing new pill UI) is the
          lower-risk way to give the same "how much room is left"
          feedback while pasting a long block of text. */}
      <p className="mt-1.5 text-right text-[12px] text-text-faint">
        {value.length}/{MAX_LENGTH}
      </p>
    </section>
  );
}