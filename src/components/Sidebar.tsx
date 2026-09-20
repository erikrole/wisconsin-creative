"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  applyThemeChoice,
  readStoredThemeChoice,
  setThemeChoice,
  subscribeToThemeChoice,
  subscribeToSystemTheme,
  THEME_CHOICES,
  type ThemeChoice,
} from "@/lib/theme";
import { UserAvatar } from "@/components/UserAvatar";
import {
  SunIcon,
  MoonIcon,
  MonitorIcon,
  LayoutGridIcon,
  CalendarIcon,
  LayersIcon,
  BoxIcon,
  UsersIcon,
  BookOpenIcon,
  ScrollTextIcon,
  BarChart3Icon,
  SettingsIcon,
  HelpCircleIcon,
  LogOutIcon,
  KeyIcon,
  WrenchIcon,
  ShieldAlertIcon,
  MegaphoneIcon,
  PenToolIcon,
  AwardIcon,
  TrophyIcon,
  ChevronsUpDownIcon,
  UserIcon,
} from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { resolveActiveShellHref } from "@/lib/shell-navigation";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: string;
  requiredRole?: "ADMIN" | "STAFF";
};

const COLLABORATOR_NAV_CAPABILITY: Partial<Record<string, string>> = {
  "/schedule": "PUBLISHED_SCHEDULE_VIEW",
  "/items": "GEAR_CATALOG_VIEW",
  "/bookings": "MY_GEAR_VIEW",
  "/users": "PEOPLE_DIRECTORY_VIEW",
  "/licenses": "SOFTWARE_VAULT_VIEW",
};

const COLLABORATOR_NAV_HREFS = [
  "/",
  "/schedule",
  "/scoreboard",
  "/items",
  "/bookings",
  "/users",
  "/licenses",
  "/settings",
] as const;

type NavGroup = {
  label?: string;
  staffOnly?: boolean;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    items: [
      { label: "Dashboard", href: "/", icon: LayoutGridIcon },
      { label: "Schedule", href: "/schedule", icon: CalendarIcon },
      { label: "Items", href: "/items", icon: LayersIcon },
      { label: "Bookings", href: "/bookings", icon: BookOpenIcon },
    ],
  },
  {
    label: "Team",
    items: [
      { label: "Scoreboard", href: "/scoreboard", icon: TrophyIcon },
      { label: "Accountability", href: "/accountability", icon: ShieldAlertIcon },
      { label: "Users", href: "/users", icon: UsersIcon },
    ],
  },
  {
    label: "Library",
    items: [
      { label: "Resources", href: "/resources", icon: ScrollTextIcon },
      { label: "Software", href: "/licenses", icon: KeyIcon },
    ],
  },
  {
    label: "Operations",
    staffOnly: true,
    items: [
      { label: "Operations", href: "/operations", icon: WrenchIcon },
      { label: "Badges", href: "/badges", icon: AwardIcon },
      { label: "Signatures", href: "/signatures", icon: PenToolIcon },
      { label: "Blasts", href: "/blasts", icon: MegaphoneIcon },
      { label: "Kits", href: "/kits", icon: BoxIcon },
      { label: "Reports", href: "/reports", icon: BarChart3Icon },
    ],
  },
  {
    items: [
      { label: "Settings", href: "/settings", icon: SettingsIcon },
    ],
  },
];

type AppSidebarProps = {
  user: {
    id: string;
    name: string;
    email: string;
    role?: string;
    avatarUrl?: string | null;
    capabilities?: string[];
    collaboratorPolicy?: { displayName: string; badgeLabel?: string } | null;
  } | null;
  onSignOut?: () => void;
  isLoggingOut?: boolean;
  overdueBadgeCount?: number;
  dueTodayBadgeCount?: number;
};

function useTheme() {
  const [theme, setThemeState] = useState<ThemeChoice>("system");

  useEffect(() => {
    const storedTheme = readStoredThemeChoice();
    setThemeState(storedTheme);
    applyThemeChoice(storedTheme);
  }, []);

  useEffect(() => subscribeToThemeChoice(setThemeState), []);

  useEffect(() => {
    if (theme !== "system") return;
    return subscribeToSystemTheme(() => applyThemeChoice("system"));
  }, [theme]);

  function setTheme(pref: ThemeChoice) {
    setThemeChoice(pref, { animate: true });
  }

  return { theme, setTheme };
}

const navButtonClass = (isActive: boolean) =>
  cn(
    "brand-identity rounded-md border-l-0 pl-2 font-medium tracking-[-0.01em] transition-[background-color,color,scale] duration-150 active:scale-[0.96] group-data-[collapsible=icon]:rounded-md group-data-[collapsible=icon]:pl-2!",
    isActive
      ? "bg-white/[0.10] font-bold text-white hover:bg-white/[0.12] hover:text-white data-[active=true]:bg-white/[0.10] data-[active=true]:font-bold data-[active=true]:text-white"
      : "text-white/55 hover:bg-white/[0.06] hover:text-white/90",
  );

export default function AppSidebar({
  user,
  onSignOut,
  isLoggingOut = false,
  overdueBadgeCount = 0,
  dueTodayBadgeCount = 0,
}: AppSidebarProps) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { isMobile, setOpenMobile, state } = useSidebar();
  const canUseAdminNav = user?.role === "ADMIN" || user?.role === "STAFF";
  const isCollaborator = user?.role === "COLLABORATOR";
  const collaboratorCapabilities = new Set(user?.capabilities ?? []);

  const visibleGroups = navGroups
    .filter((g) => !g.staffOnly || canUseAdminNav)
    .map((group) => ({
      ...group,
      items: group.items
        .filter((item) => !item.requiredRole || item.requiredRole === user?.role)
        .filter((item) => {
          if (!isCollaborator) return true;
          if (!(COLLABORATOR_NAV_HREFS as readonly string[]).includes(item.href)) return false;
          const requiredCapability = COLLABORATOR_NAV_CAPABILITY[item.href];
          return !requiredCapability || collaboratorCapabilities.has(requiredCapability);
        })
        .map((item) => {
          if (!isCollaborator) return item;
          if (item.href === "/bookings") return { ...item, label: "My Gear" };
          if (item.href === "/users") return { ...item, label: "People" };
          return item;
        }),
    }))
    .filter((group) => group.items.length > 0);

  const activeHref = resolveActiveShellHref(
    pathname,
    visibleGroups.flatMap((group) => group.items.map((item) => item.href)),
  );

  useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, pathname, setOpenMobile]);

  const roleCaption = user?.role === "COLLABORATOR"
    ? user.collaboratorPolicy?.displayName ?? "External collaborator"
    : user?.role === "ADMIN"
      ? "Admin"
      : user?.role === "STAFF"
        ? "Staff"
        : user?.role === "STUDENT"
          ? "Student"
          : "Student";

  return (
    <Sidebar collapsible="icon">
      {user && (
        <SidebarHeader className="pb-1 pt-3">
          <Link
            prefetch={false}
            href="/"
            aria-label="Wisconsin Creative home"
            className="flex items-center gap-2.5 rounded-md px-3 py-1.5 no-underline outline-none transition-colors hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-white/30 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
          >
            <Image
              src="/Badgers.png"
              alt=""
              width={28}
              height={28}
              className="size-7 shrink-0 object-contain"
              priority
            />
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <p className="brand-identity mb-[3px] text-[10px] font-medium leading-none tracking-[0.16em] text-white/50 uppercase">
                UW Athletics
              </p>
              <p className="brand-identity text-[13px] font-[800] leading-none tracking-[-0.02em] text-white">
                Wisconsin Creative
              </p>
            </div>
          </Link>
        </SidebarHeader>
      )}

      <SidebarContent className="py-1">
        <nav aria-label="Workspace navigation">
          {visibleGroups.map((group, groupIdx) => (
            <div key={group.label ?? group.items.map((item) => item.href).join("-")}>
              {!group.label && groupIdx > 0 && (
                <SidebarSeparator className="mx-3 my-2 bg-white/[0.08] group-data-[collapsible=icon]:mx-2" />
              )}
              <SidebarGroup className="px-2 py-0.5 group-data-[collapsible=icon]:px-1">
                {group.label && (
                  <SidebarGroupLabel
                    className="brand-identity h-8 px-2 text-[11px] font-medium tracking-[0.14em] text-white/45 uppercase group-data-[collapsible=icon]:hidden"
                  >
                    {group.label}
                  </SidebarGroupLabel>
                )}
                <SidebarMenu className="gap-px">
                  {group.items.map((item) => {
                    const href = item.href;
                    const isActive = activeHref === href;
                    const Icon = item.icon;
                    const badgeCfg =
                      href === "/bookings" && overdueBadgeCount > 0
                        ? { count: overdueBadgeCount, suffix: "overdue", tone: "red" as const }
                        : href === "/bookings" && dueTodayBadgeCount > 0
                        ? { count: dueTodayBadgeCount, suffix: "due today", tone: "orange" as const }
                        : null;
                    const badgeCount = badgeCfg?.count ?? 0;
                    const badgeLabel = item.badge;
                    const tooltipBase = badgeCfg
                      ? `${item.label} · ${badgeCfg.count} ${badgeCfg.suffix}`
                      : item.label;

                    return (
                      <SidebarMenuItem key={item.label}>
                        <SidebarMenuButton
                          asChild
                          isActive={isActive}
                          tooltip={tooltipBase}
                          className={navButtonClass(isActive)}
                        >
                          <Link prefetch={false} href={href} aria-current={isActive ? "page" : undefined}>
                            <Icon className={isActive ? "text-white" : "text-white/55 group-hover/menu-item:text-white/80"} />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>

                        {badgeCount > 0 && (
                          <SidebarMenuBadge
                            className={
                              badgeCfg?.tone === "orange"
                                ? "bg-[var(--orange-bg)] text-[var(--orange-text)] text-[length:var(--text-2xs)] font-semibold min-w-[18px] h-[18px] flex items-center justify-center rounded-full px-1"
                                : "bg-[var(--wi-red)] text-white text-[length:var(--text-2xs)] font-semibold min-w-[18px] h-[18px] flex items-center justify-center rounded-full px-1"
                            }
                          >
                            <span className="sr-only">
                              {badgeCfg!.count} {badgeCfg!.suffix}
                            </span>
                            <span aria-hidden="true">{badgeCount > 99 ? "99+" : badgeCount}</span>
                          </SidebarMenuBadge>
                        )}
                        {!badgeCount && badgeLabel && (
                          <SidebarMenuBadge className="bg-white/[0.08] text-white/40 text-[9px] font-medium h-[16px] flex items-center justify-center rounded px-1 tracking-wide">
                            {badgeLabel}
                          </SidebarMenuBadge>
                        )}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroup>
            </div>
          ))}
        </nav>
      </SidebarContent>

      {user && (
        <SidebarFooter className="border-t border-white/[0.07] p-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    size="lg"
                    tooltip={user.name}
                    aria-label="Account menu"
                    className="h-12 text-white/90 hover:bg-white/[0.06] hover:text-white data-[state=open]:bg-white/[0.08] group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:rounded-full"
                  >
                    <UserAvatar
                      name={user.name}
                      avatarUrl={user.avatarUrl}
                      className="ring-1 ring-white/15"
                    />
                    <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                      <p className="brand-identity truncate text-[12px] font-bold leading-tight tracking-[-0.01em] text-white">
                        {user.name}
                      </p>
                      <p
                        className="mt-[2px] truncate text-[11px] leading-tight tracking-[0.02em] text-white/50"
                        style={{ fontFamily: "var(--font-mono)" }}
                      >
                        {roleCaption}
                      </p>
                    </div>
                    <ChevronsUpDownIcon className="ml-auto size-4 text-white/35 group-data-[collapsible=icon]:hidden" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="right"
                  align="end"
                  sideOffset={8}
                  className="w-64"
                >
                  <DropdownMenuLabel className="font-normal">
                    <p className="brand-identity truncate font-bold text-foreground">{user.name}</p>
                    <p className="truncate text-xs font-normal text-muted-foreground">{user.email}</p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild className="min-h-10">
                    <Link prefetch={false} href={`/users/${user.id}`}>
                      <UserIcon />
                      Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="min-h-10">
                    <a href="mailto:erole@athletics.wisc.edu?subject=Wisconsin%20Creative%20help">
                      <HelpCircleIcon />
                      Help
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1.5" onPointerDown={(event) => event.preventDefault()}>
                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">Theme</p>
                    <ToggleGroup
                      type="single"
                      value={theme}
                      onValueChange={(value) => {
                        if (value) setTheme(value as ThemeChoice);
                      }}
                      className="w-full rounded-md border border-border bg-muted/40 p-0.5"
                    >
                      {THEME_CHOICES.map((val, i) => (
                        <ToggleGroupItem
                          key={val}
                          value={val}
                          aria-label={`${val.charAt(0).toUpperCase() + val.slice(1)} theme`}
                          className="min-h-10 min-w-10 flex-1 px-2 text-xs"
                        >
                          {i === 0 ? <SunIcon className="size-3.5" /> : i === 1 ? <MoonIcon className="size-3.5" /> : <MonitorIcon className="size-3.5" />}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    className="min-h-10 cursor-pointer"
                    disabled={isLoggingOut}
                    onSelect={() => onSignOut?.()}
                  >
                    <LogOutIcon />
                    {isLoggingOut ? "Logging out…" : "Log out"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
