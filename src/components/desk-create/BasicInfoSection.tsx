"use client";

import { SectionHeader } from "@/components/ui/desk-ui/SectionHeader";
import { TextInput } from "@/components/ui/desk-ui/TextInput";

export function BasicInfoSection({
  name,
  onNameChange,
  slug,
  onSlugChange,
}: {
  name: string;
  onNameChange: (v: string) => void;
  slug: string;
  onSlugChange: (v: string) => void;
}) {
  return (
    <section>
      <SectionHeader title="Основное" />
      <div className="flex flex-col gap-3">
        <TextInput
          corner="panel"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Название доски"
          maxLength={60}
        />
        <TextInput
          corner="panel"
          value={slug}
          onChange={(e) => onSlugChange(e.target.value)}
          placeholder="@desk"
          autoCapitalize="none"
          autoCorrect="off"
        />
      </div>
    </section>
  );
}