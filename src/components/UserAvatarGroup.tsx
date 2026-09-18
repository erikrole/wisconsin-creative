"use client";

import { UserAvatar, type UserAvatarSize } from "@/components/UserAvatar";
import { AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type UserAvatarGroupUser = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  label?: string | null;
};

export function UserAvatarGroup({
  users,
  max = 4,
  size = "sm",
  className,
  avatarClassName,
  emptyLabel = "No assignments",
  ariaLabel,
}: {
  users: UserAvatarGroupUser[];
  max?: number;
  size?: UserAvatarSize;
  className?: string;
  avatarClassName?: string;
  emptyLabel?: string;
  ariaLabel?: string;
}) {
  const visibleUsers = users.slice(0, max);
  const overflow = users.length - visibleUsers.length;

  if (users.length === 0) {
    return (
      <span className="text-[11px] font-medium text-muted-foreground">
        {emptyLabel}
      </span>
    );
  }

  return (
    <AvatarGroup
      className={className}
      aria-hidden={ariaLabel === ""}
      aria-label={ariaLabel === "" ? undefined : ariaLabel ?? `${users.length} assigned ${users.length === 1 ? "person" : "people"}`}
    >
      {visibleUsers.map((user) => {
        const label = user.label ?? user.name;
        return (
          <Tooltip key={user.id}>
            <TooltipTrigger asChild>
              <span className="cursor-default">
                <UserAvatar
                  name={user.name}
                  avatarUrl={user.avatarUrl}
                  size={size}
                  className={cn("border-2 border-background shadow-sm", avatarClassName)}
                />
              </span>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        );
      })}
      {overflow > 0 && (
        <AvatarGroupCount size={size}>
          +{overflow}
        </AvatarGroupCount>
      )}
    </AvatarGroup>
  );
}
