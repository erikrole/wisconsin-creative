"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Lato } from "next/font/google";
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
  ShirtIcon,
  WalletIcon,
  GiftIcon,
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
  MonitorPlayIcon,
  SearchIcon,
  StarIcon,
  ChevronRightIcon,
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
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { resolveActiveShellHref } from "@/lib/shell-navigation";
import { cn } from "@/lib/utils";

// Loaded here, not inherited from a page wrapper, so the rail keeps one typeface on every route.
const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], display: "swap" });

type NavItem = {
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: string;
  requiredRole?: "ADMIN" | "STAFF";
  /** Shown to both staff and admins (requiredRole matches one role exactly). */
  staffOrAdmin?: boolean;
};

const COLLABORATOR_NAV_CAPABILITY: Partial<Record<string, string>> = {
  "/schedule": "PUBLISHED_SCHEDULE_VIEW",
  "/items": "GEAR_CATALOG_VIEW",
  "/bookings": "MY_GEAR_VIEW",
  "/staff": "PEOPLE_DIRECTORY_VIEW",
  "/licenses": "SOFTWARE_VAULT_VIEW",
};

const COLLABORATOR_NAV_HREFS = [
  "/",
  "/schedule",
  "/scoreboard",
  "/items",
  "/bookings",
  "/staff",
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
      { label: "Staff", href: "/staff", icon: UsersIcon },
      { label: "Budget", href: "/budget", icon: WalletIcon, requiredRole: "ADMIN" },
      { label: "Wish list", href: "/wishlist", icon: GiftIcon, staffOrAdmin: true },
      { label: "UA Gear Picks", href: "/gear/admin", icon: ShirtIcon, requiredRole: "ADMIN" },
    ],
  },
  {
    label: "Library",
    items: [
      { label: "Resources", href: "/resources", icon: ScrollTextIcon },
      { label: "Software", href: "/licenses", icon: KeyIcon },
      { label: "YouTube Studio Lite", href: "/youtube", icon: MonitorPlayIcon, requiredRole: "ADMIN" },
    ],
  },
  {
    label: "Staff tools",
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
  onSearch?: () => void;
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

const COLLAPSED_GROUPS_KEY = "sidebar:collapsed-groups";
const PINNED_KEY = "sidebar:pinned";

/** A per-browser string list (collapsed groups, pinned pages). Storage can be blocked, so it degrades to memory. */
function useStoredList(key: string) {
  const [list, setList] = useState<string[]>([]);

  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? "[]");
      if (Array.isArray(parsed)) setList(parsed.filter((v): v is string => typeof v === "string"));
    } catch {
      // ignore unreadable storage
    }
  }, [key]);

  function toggle(value: string) {
    setList((current) => {
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // ignore quota / privacy-mode failures
      }
      return next;
    });
  }

  return [list, toggle] as const;
}

const navButtonClass = (isActive: boolean) =>
  cn(
    // 32px rows on desktop keep the full list on one laptop screen; phones keep the 40px touch floor.
    "h-8 gap-2.5 rounded-md px-2 text-[13.5px] leading-none no-underline outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sidebar-ring)] transition-[background-color,color] duration-100 max-md:h-10 max-md:text-[15px] group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:rounded-md",
    isActive
      ? "bg-[var(--sidebar-active)] font-bold text-[color:var(--sidebar-text-active)] hover:bg-[var(--sidebar-active)] hover:text-[color:var(--sidebar-text-active)] data-[active=true]:bg-[var(--sidebar-active)] data-[active=true]:font-bold data-[active=true]:text-[color:var(--sidebar-text-active)]"
      : "font-normal text-[color:var(--sidebar-text)] hover:bg-[var(--sidebar-hover)] hover:text-[color:var(--sidebar-text-active)]",
  );

export default function AppSidebar({
  user,
  onSignOut,
  isLoggingOut = false,
  overdueBadgeCount = 0,
  dueTodayBadgeCount = 0,
  onSearch,
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
        .filter((item) => !item.staffOrAdmin || canUseAdminNav)
        .filter((item) => {
          if (!isCollaborator) return true;
          if (!(COLLABORATOR_NAV_HREFS as readonly string[]).includes(item.href)) return false;
          const requiredCapability = COLLABORATOR_NAV_CAPABILITY[item.href];
          return !requiredCapability || collaboratorCapabilities.has(requiredCapability);
        })
        .map((item) => {
          if (!isCollaborator) return item;
          if (item.href === "/bookings") return { ...item, label: "My Gear" };
          if (item.href === "/staff") return { ...item, label: "People" };
          return item;
        }),
    }))
    .filter((group) => group.items.length > 0);

  const [collapsedGroups, toggleGroup] = useStoredList(COLLAPSED_GROUPS_KEY);
  const [pinnedHrefs, togglePin] = useStoredList(PINNED_KEY);
  const allVisibleItems = visibleGroups.flatMap((group) => group.items);
  const pinnedItems = pinnedHrefs
    .map((href) => allVisibleItems.find((item) => item.href === href))
    .filter((item): item is NavItem => Boolean(item));
  const groupsWithPins: NavGroup[] = [
    ...(pinnedItems.length > 0 ? [{ label: "Pinned", items: pinnedItems }] : []),
    ...visibleGroups
      .map((group) => ({ ...group, items: group.items.filter((item) => !pinnedHrefs.includes(item.href)) }))
      .filter((group) => group.items.length > 0),
  ];
  // Settings sits at the foot of the rail, apart from the places you work in.
  const footerGroup = groupsWithPins.find((group) => group.items.some((item) => item.href === "/settings") && !group.label);
  const displayGroups = groupsWithPins.filter((group) => group !== footerGroup);

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

  function renderGroup(group: NavGroup, groupIdx: number) {
    const isCollapsed = Boolean(group.label && collapsedGroups.includes(group.label));
    return (
      <SidebarGroup
        key={group.label ?? group.items.map((item) => item.href).join("-")}
        className={cn("px-2 py-0 group-data-[collapsible=icon]:px-1", groupIdx > 0 && "mt-4 group-data-[collapsible=icon]:mt-2")}
      >
        {group.label && (
            <button
              type="button"
              onClick={() => toggleGroup(group.label!)}
              aria-expanded={!isCollapsed}
              className="group/label flex h-6 w-full shrink-0 items-center justify-start gap-1 rounded-md px-2 font-bold tracking-[0.01em] text-[color:var(--sidebar-muted)] outline-none transition-colors hover:text-[color:var(--sidebar-text-active)] focus-visible:ring-2 focus-visible:ring-[var(--sidebar-ring)] max-md:h-8 group-data-[collapsible=icon]:hidden"
            >
              {/* Global `button { font-size: inherit }` is unlayered and beats utilities on the button itself. */}
              <span className="text-[11.5px] max-md:text-[13px]">{group.label}</span>
              <ChevronRightIcon
                aria-hidden="true"
                className={cn(
                  "size-3! shrink-0 transition-[transform,opacity] duration-150",
                  isCollapsed ? "opacity-100" : "rotate-90 opacity-0 group-hover/label:opacity-100 group-focus-visible/label:opacity-100 max-md:opacity-100",
                )}
              />
            </button>
        )}
        <SidebarMenu className={cn("gap-px", group.label && "mt-0.5")}>
          {group.items.map((item) => renderItem(item, isCollapsed))}
        </SidebarMenu>
      </SidebarGroup>
    );
  }

  function renderItem(item: NavItem, inCollapsedGroup: boolean) {
    const href = item.href;
    const isActive = activeHref === href;
    const isPinned = pinnedHrefs.includes(href);
    // A collapsed group still shows the page you're on, so the rail never hides where you are.
    if (inCollapsedGroup && !isActive && state !== "collapsed") return null;
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
    // Badges and the pin star share the row's right edge; the star takes over on hover.
    const yieldsToStar = "transition-opacity duration-100 md:group-hover/menu-item:opacity-0 md:group-focus-within/menu-item:opacity-0";

    return (
      <SidebarMenuItem key={item.href}>
        <SidebarMenuButton
          asChild
          isActive={isActive}
          tooltip={tooltipBase}
          className={navButtonClass(isActive)}
        >
          <Link prefetch={false} href={href} aria-current={isActive ? "page" : undefined}>
            <Icon className={cn("size-4 stroke-[1.75] transition-colors duration-100", isActive ? "text-[color:var(--sidebar-icon-active)]" : "text-[color:var(--sidebar-muted)] group-hover/menu-item:text-[color:var(--sidebar-text-active)]")} />
            <span className="truncate group-data-[collapsible=icon]:hidden">{item.label}</span>
          </Link>
        </SidebarMenuButton>

        {badgeCount > 0 && (
          <SidebarMenuBadge
            className={cn(
              "top-1/2! right-1.5 h-[18px] min-w-[18px] -translate-y-1/2 rounded-full px-1.5 text-[11px] font-bold leading-none tabular-nums group-data-[collapsible=icon]:top-1! group-data-[collapsible=icon]:right-1 group-data-[collapsible=icon]:size-2 group-data-[collapsible=icon]:min-w-0 group-data-[collapsible=icon]:translate-y-0 group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:text-transparent",
              badgeCfg?.tone === "orange"
                ? "bg-[var(--orange-bg)] text-[color:var(--orange-text)]"
                : "bg-[var(--wi-red)] text-white",
              yieldsToStar,
            )}
          >
            <span className="sr-only">
              {badgeCfg!.count} {badgeCfg!.suffix}
            </span>
            <span aria-hidden="true">{badgeCount > 99 ? "99+" : badgeCount}</span>
          </SidebarMenuBadge>
        )}
        {!badgeCount && badgeLabel && (
          <SidebarMenuBadge className={cn("top-1/2! h-4 -translate-y-1/2 rounded bg-[var(--sidebar-hover)] px-1 text-[10px] font-medium text-[color:var(--sidebar-muted)]", yieldsToStar)}>
            {badgeLabel}
          </SidebarMenuBadge>
        )}
        <SidebarMenuAction
          showOnHover
          onClick={() => togglePin(href)}
          aria-label={isPinned ? `Unpin ${item.label}` : `Pin ${item.label}`}
          aria-pressed={isPinned}
          title={isPinned ? "Unpin" : "Pin to top"}
          className="top-1/2! right-1 size-6 -translate-y-1/2 rounded text-[color:var(--sidebar-muted)] hover:bg-[var(--sidebar-hover)] hover:text-[color:var(--sidebar-text-active)] focus-visible:ring-[var(--sidebar-ring)] max-md:hidden"
        >
          <StarIcon className={cn("size-3.5!", isPinned && "fill-current text-[color:var(--sidebar-icon-active)]")} />
        </SidebarMenuAction>
      </SidebarMenuItem>
    );
  }

  return (
    <Sidebar collapsible="icon">
      <div className={cn(lato.className, "flex min-h-0 flex-1 flex-col")}>
      {user && (
        <SidebarHeader className="px-3 pb-3 pt-4 max-md:pr-12 group-data-[collapsible=icon]:px-2">
          <Link
            prefetch={false}
            href="/"
            aria-label="Wisconsin Creative home"
            className="flex items-center gap-2.5 rounded-md no-underline outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-[var(--sidebar-ring)] group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-white shadow-[0_0_0_1px_var(--sidebar-border),0_1px_2px_rgba(0,0,0,0.06)]">
              <Image
                src="/Badgers.png"
                alt=""
                width={22}
                height={22}
                className="size-[22px] object-contain"
                priority
              />
            </span>
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <p className="truncate text-[14px] font-black leading-[1.15] tracking-[-0.015em] text-[color:var(--sidebar-text-active)]">
                Wisconsin Creative
              </p>
              <p className="mt-0.5 truncate text-[12px] font-normal leading-[1.15] text-[color:var(--sidebar-muted)]">
                UW Athletics
              </p>
            </div>
          </Link>
        </SidebarHeader>
      )}

      {user && onSearch && (
        <div className="px-3 pb-2 group-data-[collapsible=icon]:px-2">
          <button
            type="button"
            onClick={onSearch}
            aria-label="Search"
            aria-keyshortcuts="Meta+K Control+K"
            className="flex h-8 w-full items-center gap-2.5 rounded-md bg-[var(--sidebar-input)] px-2 text-[13.5px] text-[color:var(--sidebar-muted)] shadow-[0_0_0_1px_var(--sidebar-border)] outline-none transition-colors hover:text-[color:var(--sidebar-text-active)] focus-visible:ring-2 focus-visible:ring-[var(--sidebar-ring)] max-md:h-10 max-md:text-[15px] group-data-[collapsible=icon]:size-10 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:shadow-none group-data-[collapsible=icon]:hover:bg-[var(--sidebar-hover)]"
          >
            <SearchIcon className="size-4 shrink-0 stroke-[1.75]" />
            <span className="flex-1 text-left text-[13.5px] max-md:text-[15px] group-data-[collapsible=icon]:hidden">Search</span>
          </button>
        </div>
      )}

      <SidebarContent className="gap-0 px-1 pb-2 pt-1">
        <nav aria-label="Workspace navigation" className="flex min-h-full flex-1 flex-col">
          {displayGroups.map((group, groupIdx) => renderGroup(group, groupIdx))}
          {footerGroup && <div className="mt-auto pt-3">{renderGroup(footerGroup, -1)}</div>}
        </nav>
      </SidebarContent>

      {user && (
        <SidebarFooter className="border-t border-[var(--sidebar-border)] p-2 group-data-[collapsible=icon]:items-center">
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    size="lg"
                    tooltip={user.name}
                    aria-label="Account menu"
                    className="h-11 gap-2.5 rounded-md px-1.5 text-[color:var(--sidebar-text-active)] hover:bg-[var(--sidebar-hover)] hover:text-[color:var(--sidebar-text-active)] data-[state=open]:bg-[var(--sidebar-active)] data-[state=open]:hover:bg-[var(--sidebar-active)] data-[state=open]:hover:text-[color:var(--sidebar-text-active)] group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:rounded-full"
                  >
                    <UserAvatar
                      name={user.name}
                      avatarUrl={user.avatarUrl}
                      className="size-8 ring-1 ring-[var(--sidebar-border)]"
                    />
                    <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                      <p className="truncate text-[13.5px] font-bold leading-[1.15] text-[color:var(--sidebar-text-active)]">
                        {user.name}
                      </p>
                      <p className="mt-0.5 truncate text-[12px] leading-[1.15] text-[color:var(--sidebar-muted)]">
                        {roleCaption}
                      </p>
                    </div>
                    <ChevronsUpDownIcon className="ml-auto size-3.5 text-[color:var(--sidebar-muted)] group-data-[collapsible=icon]:hidden" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="right"
                  align="end"
                  sideOffset={8}
                  className="w-64"
                >
                  <DropdownMenuLabel className="font-normal">
                    <p className="truncate font-bold text-foreground">{user.name}</p>
                    <p className="truncate text-xs font-normal text-muted-foreground">{user.email}</p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild className="min-h-10">
                    <Link prefetch={false} href={`/staff/${user.id}`}>
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
      </div>
    </Sidebar>
  );
}
