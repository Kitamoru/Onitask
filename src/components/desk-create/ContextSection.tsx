"use client";

import { SectionHeader } from "@/components/ui/desk-ui/SectionHeader";
import { TextInput } from "@/components/ui/desk-ui/TextInput";

export function ContextSection({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <section>
      <SectionHeader title="Контекст доски" />
      <TextInput
        corner="panel"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Краткое описание"
        maxLength={140}
      />
    </section>
  );
}