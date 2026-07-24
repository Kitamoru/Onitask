"use client";

import { SectionHeader } from "@/components/ui/desk-ui/SectionHeader";
import { TextInput } from "@/components/ui/desk-ui/TextInput";

export function BasicInfoSection({
  name,
  onNameChange,
  slug,
  onSlugChange,
  disabled = false,
}: {
  name: string;
  onNameChange: (v: string) => void;
  slug: string;
  onSlugChange: (v: string) => void;
  disabled?: boolean;
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
          maxLength={21}
        />
        {/*
          Design assumption: "максимум 4 символа строки @desk" is read
          as "the handle typed after the fixed @ is capped at 4 chars" —
          matching the placeholder example "desk" being exactly 4
          letters. The "@" itself is rendered as a static, non-deletable
          prefix rather than counted toward the 4. If the intent was
          instead "5 total characters including @", swap this back to a
          plain TextInput with maxLength={4} and placeholder="@desk".
        */}
        <TextInput
          corner="panel"
          prefix="@"
          value={slug}
          onChange={(e) =>
            onSlugChange(e.target.value.replace(/^@+/, "").slice(0, 4))
          }
          placeholder="desk"
          autoCapitalize="none"
          autoCorrect="off"
          disabled={disabled}
        />
      </div>
    </section>
  );
}