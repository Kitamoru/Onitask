"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Card } from "@/components/ui/desk-ui/Card";
import { ToggleSwitch } from "@/components/ui/desk-ui/ToggleSwitch";
import { TextInput } from "@/components/ui/desk-ui/TextInput";
import { Button } from "@/components/ui/desk-ui/Button";
import { NotchedPanel } from "@/components/ui/desk-ui/NotchedPanel";

export type ExternalLink = { title: string; url: string };

export function ExternalLinksCard({
  enabled,
  onEnabledChange,
  links,
  onLinksChange,
}: {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  links: ExternalLink[];
  onLinksChange: (links: ExternalLink[]) => void;
}) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");

  const canAdd = enabled && title.trim() && url.trim();

  const addLink = () => {
    if (!canAdd) return;
    onLinksChange([...links, { title: title.trim(), url: url.trim() }]);
    setTitle("");
    setUrl("");
  };

  const removeLink = (index: number) => {
    onLinksChange(links.filter((_, i) => i !== index));
  };

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[15px] font-medium text-text">
          Внешние ссылки
        </span>
        <ToggleSwitch
          checked={enabled}
          onChange={onEnabledChange}
          label="Внешние ссылки"
        />
      </div>

      {links.length > 0 && (
        <ul className="mb-3 flex flex-col gap-2">
          {links.map((link, i) => (
            <li key={`${link.url}-${i}`}>
              <NotchedPanel
                corner="field"
                fill="var(--color-surface)"
                contentClassName="flex items-center justify-between px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-[14px] text-text">{link.title}</p>
                  <p className="truncate text-[12px] text-text-faint">
                    {link.url}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeLink(i)}
                  aria-label="Удалить ссылку"
                  className="ml-3 shrink-0 text-text-muted"
                >
                  <X className="h-4 w-4" />
                </button>
              </NotchedPanel>
            </li>
          ))}
        </ul>
      )}

      <div className="mb-3 flex flex-col gap-3">
        <TextInput
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Название ресурса"
          disabled={!enabled}
        />
        <TextInput
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Ссылка"
          disabled={!enabled}
          inputMode="url"
          autoCapitalize="none"
        />
      </div>

      <Button variant="outline" disabled={!canAdd} onClick={addLink}>
        Добавить ссылку
      </Button>
    </Card>
  );
}