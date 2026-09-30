"use client";

import Image from "next/image";
import { ImageIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DraftItemImage } from "@/lib/item-image-draft";
import { FormRow } from "@/components/form-layout";
import type { ItemImageSuggestionStatus } from "@/lib/item-image-suggestion";
import { FormSection } from "./FormSection";

type Props = {
  image: DraftItemImage | null;
  suggestionStatus?: ItemImageSuggestionStatus;
  disabled?: boolean;
  onChoose: () => void;
  onClear: () => void;
  embedded?: boolean;
};

export function ItemImageDraftField({
  image,
  suggestionStatus = "idle",
  disabled = false,
  onChoose,
  onClear,
  embedded = false,
}: Props) {
  const field = (
    <div className="flex items-center gap-3 rounded-md border border-border/60 bg-muted/20 p-3">
        <div className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-background sm:size-20">
          {image ? (
            <Image
              src={image.previewUrl}
              alt="Selected item image"
              fill
              sizes="80px"
              className="object-contain"
              unoptimized
            />
          ) : (
            <ImageIcon className="size-6 text-muted-foreground" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {image ? "Image ready to save" : suggestionStatus === "loading" ? "Finding a B&H product photo…" : "No image selected"}
          </p>
          <p role="status" className="mt-1 text-xs text-muted-foreground">
            {image?.kind === "file"
              ? image.file.name
              : image
                ? suggestionStatus === "ready" ? "B&H product photo · You can change or remove it." : "Product image selected"
                : suggestionStatus === "loading" ? "Looking up the first product photo. You can keep entering details."
                  : suggestionStatus === "empty" ? "No B&H product photo found. Choose an image or continue without one."
                    : suggestionStatus === "unavailable" ? "Automatic lookup is unavailable. Choose an image or continue without one."
                      : "Enter a product name or brand and model to find a B&H photo automatically."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-10"
              onClick={onChoose}
              disabled={disabled}
            >
              <ImageIcon className="size-4" />
              {image ? "Change image" : "Choose image"}
            </Button>
            {image && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-10 text-destructive hover:text-destructive"
                onClick={onClear}
                disabled={disabled}
              >
                <Trash2Icon className="size-4" />
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>
  );

  if (embedded) {
    return (
      <FormRow label="Image">
        {field}
      </FormRow>
    );
  }

  return (
    <FormSection
      title="Image"
      badge="Optional"
      badgeVariant="secondary"
      description="Choose a product image by search, URL, or file. It will be saved after the item is created."
    >
      {field}
    </FormSection>
  );
}
