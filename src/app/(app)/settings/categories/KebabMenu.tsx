"use client";

import { FolderInputIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { OperationalRowActions } from "@/components/OperationalRowActions";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export default function KebabMenu({
  onRename,
  onAddSub,
  onMove,
  onDelete,
  hasItems,
  hasChildren,
  isAdmin,
}: {
  onRename: () => void;
  onAddSub: () => void;
  onMove: () => void;
  onDelete: () => void;
  hasItems: boolean;
  hasChildren: boolean;
  isAdmin: boolean;
}) {
  const canDelete = isAdmin && !hasItems && !hasChildren;
  const shortReason = !isAdmin
    ? "admin only"
    : hasItems
      ? "has items"
      : hasChildren
        ? "has subcategories"
        : "";
  const fullReason = !isAdmin
    ? "Only admins can delete categories"
    : hasItems
      ? "Remove linked items first"
      : hasChildren
        ? "Remove subcategories first"
        : "";

  return (
    <OperationalRowActions
      label="Category actions"
    >
      <DropdownMenuItem onSelect={onRename}>
        <PencilIcon className="size-4" />
        Rename
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onAddSub}>
        <PlusIcon className="size-4" />
        Add subcategory
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onMove}>
        <FolderInputIcon className="size-4" />
        Move…
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        variant="destructive"
        disabled={!canDelete}
        onSelect={onDelete}
        title={fullReason}
      >
        <Trash2Icon className="size-4" />
        Delete
        {shortReason && (
          <span className="ml-auto text-xs text-muted-foreground">{shortReason}</span>
        )}
      </DropdownMenuItem>
    </OperationalRowActions>
  );
}
