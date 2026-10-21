"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { BriefcaseBusinessIcon, MailIcon, MapPinIcon, PhoneIcon, SlackIcon, UsersIcon } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { UserAvatar } from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Role, ShiftArea } from "@/lib/client-enums";
import { sportLabel } from "@/lib/sports";

// Contacts and sport assignments are profile-backed references that sit beside
// the Guide library; they read live user data rather than guide Markdown.

export type ContactUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  phone: string | null;
  slackHandle: string | null;
  slackProfileUrl: string | null;
  primaryArea: ShiftArea | null;
  location: string | null;
  avatarUrl: string | null;
  active?: boolean;
  title: string | null;
  gradYear: number | null;
  studentYearOverride: "FRESHMAN" | "SOPHOMORE" | "JUNIOR" | "SENIOR" | "GRAD" | null;
  sportAssignments: {
    sportCode: string;
    defaultTraveler: boolean;
  }[];
};

export type ContactUsersResponse = {
  data: ContactUser[];
  total: number;
};

export type ContactRoleFilter = "ALL" | Role;
export type ContactAreaFilter = "ALL" | ShiftArea | "UNASSIGNED";
export type ContactHygieneFilter = "ALL" | "MISSING_PHONE" | "MISSING_SLACK";

const CONTACT_ROLE_FILTERS: { value: ContactRoleFilter; label: string }[] = [
  { value: "ALL", label: "All roles" },
  { value: Role.STAFF, label: "Staff" },
  { value: Role.STUDENT, label: "Students" },
  { value: Role.ADMIN, label: "Admins" },
];

const CONTACT_AREA_FILTERS: { value: ContactAreaFilter; label: string }[] = [
  { value: "ALL", label: "All areas" },
  { value: ShiftArea.VIDEO, label: "Video" },
  { value: ShiftArea.PHOTO, label: "Photo" },
  { value: ShiftArea.GRAPHICS, label: "Graphics" },
  { value: ShiftArea.SOCIAL, label: "Social" },
  { value: ShiftArea.COMMS, label: "Comms" },
  { value: ShiftArea.LIVE_PRODUCTION, label: "Live Production" },
  { value: "UNASSIGNED", label: "No area" },
];

const CONTACT_HYGIENE_FILTERS: { value: ContactHygieneFilter; label: string }[] = [
  { value: "ALL", label: "All contacts" },
  { value: "MISSING_PHONE", label: "Missing phone" },
  { value: "MISSING_SLACK", label: "Missing Slack" },
];

export function contactSearchText(user: ContactUser) {
  return [
    user.name,
    user.email,
    user.phone,
    user.slackHandle,
    user.slackProfileUrl,
    user.title,
    user.role,
    user.primaryArea,
    user.location,
    ...(user.sportAssignments ?? []).flatMap((assignment) => [
      assignment.sportCode,
      sportLabel(assignment.sportCode),
      assignment.defaultTraveler ? "default traveler" : null,
    ]),
    user.gradYear ? String(user.gradYear) : null,
    user.studentYearOverride,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function formatArea(area: ShiftArea | null) {
  if (!area) return null;
  const labels: Record<ShiftArea, string> = {
    VIDEO: "Video",
    PHOTO: "Photo",
    GRAPHICS: "Graphics",
    SOCIAL: "Social",
    COMMS: "Comms",
    LIVE_PRODUCTION: "Live Production",
  };
  return labels[area];
}

function formatRole(role: Role) {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

function formatStudentYear(user: ContactUser) {
  if (user.studentYearOverride) {
    return user.studentYearOverride.charAt(0) + user.studentYearOverride.slice(1).toLowerCase();
  }
  if (!user.gradYear) return null;
  return `Class of ${user.gradYear}`;
}

function contactSubtitle(user: ContactUser) {
  return user.role === Role.STUDENT ? formatStudentYear(user) : user.title;
}

function displaySlackHandle(value: string | null) {
  if (!value) return null;
  const normalized = value.trim().replace(/^@+/, "");
  return normalized ? `@${normalized}` : null;
}

export function hasSlackContact(user: ContactUser) {
  return Boolean(displaySlackHandle(user.slackHandle) || user.slackProfileUrl);
}

export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground text-pretty">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export type SportAssignmentGroup = {
  sportCode: string;
  label: string;
  users: ContactUser[];
  defaultTravelers: ContactUser[];
};

export function buildSportAssignmentGroups(users: ContactUser[]): SportAssignmentGroup[] {
  const bySport = new Map<string, { users: ContactUser[]; defaultTravelers: ContactUser[] }>();

  for (const user of users) {
    for (const assignment of user.sportAssignments ?? []) {
      const group = bySport.get(assignment.sportCode) ?? { users: [], defaultTravelers: [] };
      group.users.push(user);
      if (assignment.defaultTraveler) group.defaultTravelers.push(user);
      bySport.set(assignment.sportCode, group);
    }
  }

  return [...bySport.entries()]
    .map(([sportCode, group]) => ({
      sportCode,
      label: sportLabel(sportCode),
      users: group.users.sort((a, b) => a.name.localeCompare(b.name)),
      defaultTravelers: group.defaultTravelers.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function totalAssignedPeople(groups: SportAssignmentGroup[]) {
  return new Set(groups.flatMap((group) => group.users.map((user) => user.id))).size;
}

export function SportAssignmentsDirectory({
  groups,
  loading,
  search,
}: {
  groups: SportAssignmentGroup[];
  loading: boolean;
  search: string;
}) {
  if (loading) {
    return (
      <section className="flex flex-col gap-3">
        <SectionHeader
          title="Sport assignments"
          description="Read-only sport coverage sourced from user profile assignments."
        />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-36 rounded-lg" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Sport assignments"
        description="Read-only sport coverage sourced from user profile assignments."
      />
      {groups.length === 0 ? (
        <EmptyState
          inline
          icon="users"
          title="No sport assignments match this view"
          description={
            search.trim()
              ? "Try a different search across people, sport codes, or sport names."
              : "No active user profiles have sport assignments yet."
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <Card key={group.sportCode} elevation="flat" className="min-h-36">
              <CardHeader className="gap-2 p-4 pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-sm">{group.label}</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">{group.sportCode}</p>
                  </div>
                  <Badge variant="secondary" className="shrink-0 tabular-nums">
                    {group.users.length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 p-4">
                {group.defaultTravelers.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {group.defaultTravelers.map((user) => (
                      <Badge key={user.id} variant="outline" className="max-w-full">
                        <span className="truncate">{user.name}</span>
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  {group.users.slice(0, 5).map((user) => (
                    <Link
                      key={user.id}
                      href={`/staff/${user.id}`}
                      className="flex min-h-10 min-w-0 items-center gap-2 rounded-md px-1 text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <UserAvatar
                        name={user.name}
                        avatarUrl={user.avatarUrl}
                        size="sm"
                        className="shrink-0"
                      />
                      <span className="truncate">{user.name}</span>
                    </Link>
                  ))}
                  {group.users.length > 5 && (
                    <p className="text-xs text-muted-foreground tabular-nums">
                      +{group.users.length - 5} more
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

export function LiveContactsDirectory({
  users,
  loading,
  total,
  search,
  roleFilter,
  areaFilter,
  hygieneFilter,
  onRoleFilterChange,
  onAreaFilterChange,
  onHygieneFilterChange,
  stats,
  canSeeContactHygiene,
  compact,
  onShowAll,
}: {
  users: ContactUser[];
  loading: boolean;
  total: number;
  search: string;
  roleFilter: ContactRoleFilter;
  areaFilter: ContactAreaFilter;
  hygieneFilter: ContactHygieneFilter;
  onRoleFilterChange: (value: ContactRoleFilter) => void;
  onAreaFilterChange: (value: ContactAreaFilter) => void;
  onHygieneFilterChange: (value: ContactHygieneFilter) => void;
  stats: {
    visible: number;
    total: number;
    missingPhone: number;
    missingSlack: number;
  };
  canSeeContactHygiene: boolean;
  compact: boolean;
  onShowAll: () => void;
}) {
  const shownUsers = compact ? users.slice(0, 6) : users;
  const hasContactFilters = roleFilter !== "ALL" || areaFilter !== "ALL" || hygieneFilter !== "ALL";

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <UsersIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            Team contacts
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground text-pretty">
            Profile-backed contacts support the Guide library without duplicating phone and Slack details in Markdown.
          </p>
        </div>
        {!loading && (
          <div className="flex flex-wrap items-center gap-2">
            {canSeeContactHygiene && stats.missingPhone > 0 && (
              <Badge variant="outline" className="tabular-nums">
                {stats.missingPhone} missing phone
              </Badge>
            )}
            {canSeeContactHygiene && stats.missingSlack > 0 && (
              <Badge variant="outline" className="tabular-nums">
                {stats.missingSlack} missing Slack
              </Badge>
            )}
            <Badge variant="secondary" className="tabular-nums">
              {compact ? Math.min(users.length, 6) : stats.visible}/{total} shown
            </Badge>
          </div>
        )}
      </div>

      {!compact && !loading && (
        <ContactDirectoryFilters
          roleFilter={roleFilter}
          areaFilter={areaFilter}
          hygieneFilter={hygieneFilter}
          onRoleFilterChange={onRoleFilterChange}
          onAreaFilterChange={onAreaFilterChange}
          onHygieneFilterChange={onHygieneFilterChange}
          canSeeContactHygiene={canSeeContactHygiene}
        />
      )}

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: compact ? 3 : 6 }).map((_, index) => (
            <Skeleton key={index} className="h-32 rounded-lg" />
          ))}
        </div>
      ) : shownUsers.length === 0 ? (
        <EmptyState
          inline
          icon="users"
          title="No contacts match this view"
          description={
            search.trim() || hasContactFilters
              ? "Try a different contact search or filter."
              : "No active users are available for the live contact directory."
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shownUsers.map((user) => (
            <ContactCard key={user.id} user={user} />
          ))}
        </div>
      )}

      {compact && users.length > 6 && (
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" className="h-10" onClick={onShowAll}>
            Show all contacts
          </Button>
        </div>
      )}
    </section>
  );
}

function ContactDirectoryFilters({
  roleFilter,
  areaFilter,
  hygieneFilter,
  onRoleFilterChange,
  onAreaFilterChange,
  onHygieneFilterChange,
  canSeeContactHygiene,
}: {
  roleFilter: ContactRoleFilter;
  areaFilter: ContactAreaFilter;
  hygieneFilter: ContactHygieneFilter;
  onRoleFilterChange: (value: ContactRoleFilter) => void;
  onAreaFilterChange: (value: ContactAreaFilter) => void;
  onHygieneFilterChange: (value: ContactHygieneFilter) => void;
  canSeeContactHygiene: boolean;
}) {
  return (
    <div className="grid gap-3 rounded-md bg-muted/30 p-3 md:grid-cols-2 xl:grid-cols-3">
      <ContactSelect
        label="Role"
        value={roleFilter}
        options={CONTACT_ROLE_FILTERS}
        onChange={onRoleFilterChange}
      />
      <ContactSelect
        label="Area"
        value={areaFilter}
        options={CONTACT_AREA_FILTERS}
        onChange={onAreaFilterChange}
      />
      {canSeeContactHygiene && (
        <ContactSelect
          label="Cleanup"
          value={hygieneFilter}
          options={CONTACT_HYGIENE_FILTERS}
          onChange={onHygieneFilterChange}
        />
      )}
    </div>
  );
}

function ContactSelect<TValue extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: TValue;
  options: { value: TValue; label: string }[];
  onChange: (value: TValue) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground">
      {label}
      <Select value={value} onValueChange={(next) => onChange(next as TValue)}>
        <SelectTrigger className="h-10 bg-background text-foreground" aria-label={`${label} contact filter`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>{label}</SelectLabel>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </label>
  );
}

function ContactCard({ user }: { user: ContactUser }) {
  const subtitle = contactSubtitle(user);
  const area = formatArea(user.primaryArea);
  const slackHandle = displaySlackHandle(user.slackHandle);

  return (
    <Card elevation="flat" className="min-h-32 border-border/80">
      <CardHeader className="p-4 pb-0">
        <div className="flex items-start gap-3">
          <UserAvatar
            name={user.name}
            avatarUrl={user.avatarUrl}
            size="lg"
            className="shrink-0 ring-1 ring-border"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <CardTitle className="truncate text-sm leading-tight">{user.name}</CardTitle>
                {subtitle && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>
                )}
              </div>
              <Badge variant="secondary" size="sm" className="shrink-0">
                {formatRole(user.role)}
              </Badge>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="grid flex-1 content-start gap-2 p-4 text-xs text-muted-foreground">
        <ContactLine icon={MailIcon} label={user.email} href={`mailto:${user.email}`} />
        <ContactLine
          icon={PhoneIcon}
          label={user.phone || "No phone on profile"}
          href={user.phone ? `tel:${user.phone.replace(/[^\d+]/g, "")}` : undefined}
        />
        <ContactLine
          icon={SlackIcon}
          label={slackHandle || (user.slackProfileUrl ? "Slack profile" : "No Slack on profile")}
          href={user.slackProfileUrl ?? undefined}
        />
        <div className="flex min-w-0 flex-wrap gap-2">
          {area && (
            <span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-muted px-2 py-1">
              <BriefcaseBusinessIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{area}</span>
            </span>
          )}
          {user.location && (
            <span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-muted px-2 py-1">
              <MapPinIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{user.location}</span>
            </span>
          )}
        </div>
      </CardContent>

      <CardFooter className="px-4 pb-4 pt-0">
        <Button asChild variant="outline" size="sm" className="h-10 w-full justify-center">
          <Link href={`/staff/${user.id}`}>View profile</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function ContactLine({
  icon: Icon,
  label,
  href,
}: {
  icon: LucideIcon;
  label: string;
  href?: string;
}) {
  const content = (
    <>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </>
  );

  if (!href) {
    return <div className="flex min-h-6 min-w-0 items-center gap-2">{content}</div>;
  }

  return (
    <a
      href={href}
      className="flex min-h-10 min-w-0 items-center gap-2 rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {content}
    </a>
  );
}
