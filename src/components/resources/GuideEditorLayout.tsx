"use client";

import type { ReactNode } from "react";

/**
 * Shared frame for writing and editing a guide: a slim top bar with the way
 * back and the save actions, the guide itself as a document (big title, then
 * the editor), and settings in a quiet side panel that stacks below on phones.
 */
export function GuideEditorLayout({
  back,
  status,
  actions,
  title,
  onTitleChange,
  disabled,
  beforeEditor,
  editor,
  settings,
  footer,
}: {
  back: ReactNode;
  status: string;
  actions: ReactNode;
  title: string;
  onTitleChange: (value: string) => void;
  disabled?: boolean;
  beforeEditor?: ReactNode;
  editor: ReactNode;
  settings: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col px-4 pb-16 sm:px-6 lg:px-10">
      <div className="guide-editor-bar">
        <div className="flex min-w-0 items-center gap-3">
          {back}
          <span className="truncate text-sm text-muted-foreground" aria-live="polite">{status}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </div>

      <div className="guide-editor-grid">
        <div className="flex min-w-0 flex-col gap-5">
          <label htmlFor="guide-title" className="sr-only">Title</label>
          <textarea
            id="guide-title"
            value={title}
            onChange={(event) => onTitleChange(event.target.value.replace(/\n/g, " "))}
            placeholder="Untitled guide"
            rows={1}
            maxLength={200}
            disabled={disabled}
            className="guide-editor-title"
          />
          {beforeEditor}
          <div className="guide-editor-body">{editor}</div>
        </div>

        <aside className="guide-editor-settings">
          {settings}
          {footer}
        </aside>
      </div>
    </div>
  );
}
