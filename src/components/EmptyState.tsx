"use client";

import Link from "next/link";
import {
  SearchIcon,
  CalendarIcon,
  BoxIcon,
  ClipboardCheckIcon,
  BellIcon,
  UsersIcon,
  FolderIcon,
  BarChart3Icon,
  WifiOffIcon,
  CheckCircle2Icon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";

type EmptyStateProps = {
  icon?: "search" | "calendar" | "box" | "clipboard" | "bell" | "users" | "folder" | "chart" | "wifi-off" | "check";
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  compact?: boolean;
  inline?: boolean;
};

const iconMap: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  search: SearchIcon,
  calendar: CalendarIcon,
  box: BoxIcon,
  clipboard: ClipboardCheckIcon,
  bell: BellIcon,
  users: UsersIcon,
  folder: FolderIcon,
  chart: BarChart3Icon,
  "wifi-off": WifiOffIcon,
  check: CheckCircle2Icon,
};

export default function EmptyState({
  icon = "box",
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
  compact = false,
  inline = false,
}: EmptyStateProps) {
  const Icon = iconMap[icon] ?? BoxIcon;
  return (
    <Empty className={inline ? "border-0 px-4 py-6" : compact ? "border-0 py-4" : "border-0 py-10"}>
      <EmptyHeader>
        <EmptyMedia variant="icon" className={inline ? "size-9 rounded-md" : undefined}>
          <Icon className="size-6 text-muted-foreground" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {actionLabel && actionHref && (
        <Button className="h-10" asChild>
          <Link href={actionHref}>{actionLabel}</Link>
        </Button>
      )}
      {actionLabel && onAction && !actionHref && (
        <Button className="h-10" onClick={onAction}>{actionLabel}</Button>
      )}
    </Empty>
  );
}
