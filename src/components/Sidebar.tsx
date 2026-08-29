"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getInitials } from "@/lib/avatar";
import {
  applyThemeChoice,
  readStoredThemeChoice,
  setThemeChoice,
  subscribeToThemeChoice,
  subscribeToSystemTheme,
  THEME_CHOICES,
  type ThemeChoice,
} from "@/lib/theme";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
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
  BellIcon,
  KeyIcon,
  WrenchIcon,
  ShieldAlertIcon,
  MegaphoneIcon,
  PenToolIcon,
  TrophyIcon,
} from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { resolveActiveShellHref } from "@/lib/shell-navigation";

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
      { label: "Scoreboard", href: "/scoreboard", icon: TrophyIcon },
      { label: "Items", href: "/items", icon: LayersIcon },
      { label: "Bookings", href: "/bookings", icon: BookOpenIcon },
      { label: "Accountability", href: "/accountability", icon: ShieldAlertIcon },
      { label: "Resources", href: "/resources", icon: ScrollTextIcon },
      { label: "Software", href: "/licenses", icon: KeyIcon },
      { label: "Users", href: "/users", icon: UsersIcon },
      { label: "Notifications", href: "/notifications", icon: BellIcon },
      { label: "Settings", href: "/settings", icon: SettingsIcon },
    ],
  },
  {
    label: "Operations",
    staffOnly: true,
    items: [
      { label: "Operations", href: "/operations", icon: WrenchIcon },
      { label: "Signatures", href: "/signatures", icon: PenToolIcon },
      { label: "Blasts", href: "/blasts", icon: MegaphoneIcon },
      { label: "Kits", href: "/kits", icon: BoxIcon },
      { label: "Reports", href: "/reports", icon: BarChart3Icon },
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
  unreadNotifications?: number;
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

export default function AppSidebar({
  user,
  onSignOut,
  isLoggingOut = false,
  overdueBadgeCount = 0,
  dueTodayBadgeCount = 0,
  unreadNotifications = 0,
}: AppSidebarProps) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { isMobile, setOpenMobile } = useSidebar();
  const canUseAdminNav = user?.role === "ADMIN" || user?.role === "STAFF";
  const isCollaborator = user?.role === "COLLABORATOR";
  const collaboratorCapabilities = new Set(user?.capabilities ?? []);

  const userInitials = user ? getInitials(user.name) : "?";

  const visibleGroups = navGroups
    .filter((g) => !g.staffOnly || canUseAdminNav)
    .map((group) => ({
      ...group,
      items: group.items
        .filter((item) => !item.requiredRole || item.requiredRole === user?.role)
        .filter((item) => {
          if (!isCollaborator) return true;
          if (!["/", "/schedule", "/scoreboard", "/items", "/bookings", "/users", "/notifications", "/licenses"].includes(item.href)) return false;
          const requiredCapability = COLLABORATOR_NAV_CAPABILITY[item.href];
          return !requiredCapability || collaboratorCapabilities.has(requiredCapability);
        })
        .map((item) => isCollaborator && item.href === "/bookings" ? { ...item, label: "My Gear" } : item),
    }))
    .filter((group) => group.items.length > 0);

  const activeHref = resolveActiveShellHref(
    pathname,
    visibleGroups.flatMap((group) => group.items.map((item) => item.href)),
  );

  useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, pathname, setOpenMobile]);

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      {user && (
        <SidebarHeader className="pb-0 pt-4">
          {/* ── Brand lockup ── */}
          <div className="flex items-center gap-3 px-4 pb-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2">
            <Image
              src="/Badgers.png"
              alt="Wisconsin Badgers"
              width={28}
              height={28}
              className="size-7 shrink-0 object-contain"
              priority
            />
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <p
              className="text-[11px] tracking-[0.16em] text-white/60 uppercase leading-none mb-[3px]"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                UW Athletics
              </p>
              <p
                className="text-[13.5px] text-white leading-none"
                style={{ fontFamily: "var(--font-heading)", fontWeight: 800 }}
              >
                Wisconsin Creative
              </p>
            </div>
          </div>

          {/* Divider */}
          <div className="mx-3 mb-2 h-px bg-white/[0.07] group-data-[collapsible=icon]:mx-2" />

          {/* ── User card ── */}
          <SidebarMenu className="pb-1 px-2 group-data-[collapsible=icon]:items-center">
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                size="lg"
                tooltip={user.name}
                className="hover:bg-white/[0.05] active:bg-white/[0.05] data-[active=true]:bg-white/[0.05] group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:rounded-full"
              >
                <Link
                  prefetch={false}
                  href={`/users/${user.id}`}
                  className="flex items-center gap-2.5 group-data-[collapsible=icon]:gap-0"
                >
                  <Avatar className="size-7 shrink-0 ring-1 ring-white/[0.15] bg-white/[0.08] group-data-[collapsible=icon]:mx-auto">
                    {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.name} />}
                    <AvatarFallback
                      className="bg-transparent text-white/80 text-[length:var(--text-2xs)] font-bold"
                      style={{ fontFamily: "var(--font-heading)" }}
                    >
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                    <p
                      className="text-[12px] text-white/90 truncate leading-tight"
                      style={{ fontFamily: "var(--font-heading)", fontWeight: 600 }}
                    >
                      {user.name}
                    </p>
                    <p
                      className={`text-[11px] text-white/60 truncate leading-tight mt-[2px] tracking-[0.1em] ${user.role === "COLLABORATOR" ? "" : "uppercase"}`}
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {user.role === "COLLABORATOR"
                        ? user.collaboratorPolicy?.displayName ?? "External collaborator"
                        : user.role ?? "Student"}
                    </p>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
      )}

      {/* ── Navigation groups ── */}
      <SidebarContent className="py-1">
        <nav aria-label="Workspace navigation">
        {visibleGroups.map((group, groupIdx) => (
          <div key={groupIdx}>
            {groupIdx > 0 && (
              <div className="px-3 py-3 group-data-[collapsible=icon]:px-2">
                {/* Expanded: label flanked by rules */}
                <div className="flex items-center gap-2 group-data-[collapsible=icon]:hidden">
                  <div className="h-px flex-1 bg-white/[0.1]" />
                  <span
                    className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/70 select-none"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {group.label}
                  </span>
                  <div className="h-px flex-1 bg-white/[0.1]" />
                </div>
                {/* Collapsed: just a rule */}
                <div className="hidden group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:block group-data-[collapsible=icon]:h-px group-data-[collapsible=icon]:w-6 group-data-[collapsible=icon]:bg-white/[0.12]" />
              </div>
            )}

            <SidebarGroup className="px-2 py-0">
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
                      : href === "/notifications" && unreadNotifications > 0
                      ? { count: unreadNotifications, suffix: "unread", tone: "red" as const }
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
                        className={
                          isActive
                            ? "data-[active=true]:bg-[var(--wi-red)]/12 data-[active=true]:text-white border-l-2 border-l-[var(--wi-red)] rounded-r-md rounded-l-none pl-[calc(0.5rem-2px)] transition-[background-color,border-color,color,scale] duration-150 active:scale-[0.96] group-data-[collapsible=icon]:rounded-md group-data-[collapsible=icon]:border-l-transparent group-data-[collapsible=icon]:bg-white/[0.08] group-data-[collapsible=icon]:pl-2!"
                            : "text-white/50 hover:text-white/90 hover:bg-white/[0.055] border-l-2 border-l-transparent rounded-r-md rounded-l-none pl-[calc(0.5rem-2px)] transition-[background-color,border-color,color,scale] duration-150 active:scale-[0.96] group-data-[collapsible=icon]:rounded-md group-data-[collapsible=icon]:pl-2!"
                        }
                      >
                        <Link prefetch={false} href={href} aria-current={isActive ? "page" : undefined}>
                          <Icon className={isActive ? "text-white" : "text-white/55 group-hover/menu-item:text-white/80"} />
                          <span style={{ fontFamily: "var(--font-heading)", fontWeight: 500 }}>
                            {item.label}
                          </span>
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

      {/* ── Footer: theme toggle + logout ── */}
      <SidebarFooter className="border-t border-white/[0.07] py-2">
        <div className="flex items-center justify-center px-3 py-1 group-data-[collapsible=icon]:hidden">
          <ToggleGroup
            type="single"
            value={theme}
            onValueChange={(v) => {
              if (v) setTheme(v as ThemeChoice);
            }}
            className="bg-white/[0.06] rounded-md p-0.5"
          >
            {THEME_CHOICES.map((val, i) => (
              <ToggleGroupItem
                key={val}
                value={val}
                aria-label={`${val.charAt(0).toUpperCase() + val.slice(1)} theme`}
                className="min-h-10 min-w-10 text-white/60 px-2.5 py-1 text-xs hover:bg-transparent hover:text-white/85 data-[state=on]:bg-white/[0.12] data-[state=on]:text-white/95 data-[state=on]:shadow-none data-[state=on]:rounded"
              >
                {i === 0 ? <SunIcon className="size-3.5" /> : i === 1 ? <MoonIcon className="size-3.5" /> : <MonitorIcon className="size-3.5" />}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <SidebarMenu className="px-2">
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip="Help & support"
              className="text-white/55 transition-[background-color,color,scale] duration-150 hover:bg-white/[0.05] hover:text-white/85 active:scale-[0.96]"
            >
              <a href="mailto:erole@athletics.wisc.edu?subject=Wisconsin%20Creative%20help">
                <HelpCircleIcon />
                <span>Help</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={isLoggingOut ? "Logging out…" : "Log out"}
              onClick={onSignOut}
              disabled={isLoggingOut}
              className="cursor-pointer text-white/35 transition-[background-color,color,scale] duration-150 hover:bg-white/[0.05] hover:text-white/75 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <LogOutIcon />
              <span>{isLoggingOut ? "Logging out…" : "Log out"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
