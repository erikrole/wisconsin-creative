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
  HouseIcon,
  CalendarDaysIcon,
  CameraIcon,
  ClipboardListIcon,
  BackpackIcon,
  UsersIcon,
  BookMarkedIcon,
  ShirtIcon,
  WalletIcon,
  GiftIcon,
  ChartColumnIcon,
  SettingsIcon,
  LifeBuoyIcon,
  LogOutIcon,
  KeyRoundIcon,
  WrenchIcon,
  ShieldAlertIcon,
  MegaphoneIcon,
  SignatureIcon,
  MedalIcon,
  TrophyIcon,
  ChevronsUpDownIcon,
  UserIcon,
  SquarePlayIcon,
  SearchIcon,
  ChevronRightIcon,
  PinIcon,
} from "lucide-react";
import { SidebarCustomizeDialog } from "@/components/SidebarCustomizeDialog";
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
] as const;

type NavGroup = {
  label?: string;
  staffOnly?: boolean;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    items: [
      { label: "Dashboard", href: "/", icon: HouseIcon },
      { label: "Schedule", href: "/schedule", icon: CalendarDaysIcon },
      { label: "Bookings", href: "/bookings", icon: ClipboardListIcon },
      { label: "Items", href: "/items", icon: CameraIcon },
    ],
  },
  {
    label: "People",
    items: [
      { label: "Staff", href: "/staff", icon: UsersIcon },
      { label: "Scoreboard", href: "/scoreboard", icon: TrophyIcon },
      { label: "Accountability", href: "/accountability", icon: ShieldAlertIcon },
    ],
  },
  {
    label: "Purchasing",
    items: [
      { label: "Budget", href: "/budget", icon: WalletIcon, requiredRole: "ADMIN" },
      { label: "Wish list", href: "/wishlist", icon: GiftIcon, staffOrAdmin: true },
      { label: "UA Gear Picks", href: "/gear/admin", icon: ShirtIcon, requiredRole: "ADMIN" },
    ],
  },
  {
    label: "Library",
    items: [
      { label: "Resources", href: "/resources", icon: BookMarkedIcon },
      { label: "Software", href: "/licenses", icon: KeyRoundIcon },
    ],
  },
  {
    label: "Staff tools",
    staffOnly: true,
    items: [
      { label: "Operations", href: "/operations", icon: WrenchIcon },
      { label: "Kits", href: "/kits", icon: BackpackIcon },
      { label: "Badges", href: "/badges", icon: MedalIcon },
      { label: "Signatures", href: "/signatures", icon: SignatureIcon },
      { label: "Blasts", href: "/blasts", icon: MegaphoneIcon },
      { label: "YouTube Studio Lite", href: "/youtube", icon: SquarePlayIcon, requiredRole: "ADMIN" },
      { label: "Reports", href: "/reports", icon: ChartColumnIcon },
    ],
  },
];

// Settings lives in the account menu at the foot of the rail, not in the page list.
const SETTINGS_HREF = "/settings";

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
  /** Quiet counts of things to act on, keyed by nav href. */
  attentionCounts?: Partial<Record<string, { count: number; suffix: string }>>;
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

  function save(next: string[]) {
    setList(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // ignore quota / privacy-mode failures
    }
  }

  function toggle(value: string) {
    save(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  return [list, toggle, save] as const;
}

const menuItemClass = "min-h-9 gap-2.5 rounded-md px-2 text-[13.5px] [&_svg]:size-4 [&_svg]:stroke-[1.75] [&_svg]:text-muted-foreground";

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
  attentionCounts,
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
  const [pinnedHrefs, , setPinnedHrefs] = useStoredList(PINNED_KEY);
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
  const displayGroups = groupsWithPins;
  const isOnAccountPage = pathname === SETTINGS_HREF || pathname.startsWith(`${SETTINGS_HREF}/`) || pathname === `/staff/${user?.id}`;
  const [customizeOpen, setCustomizeOpen] = useState(false);

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
    // A collapsed group still shows the page you're on, so the rail never hides where you are.
    if (inCollapsedGroup && !isActive && state !== "collapsed") return null;
    const Icon = item.icon;
    const badgeCfg =
      href === "/bookings" && overdueBadgeCount > 0
        ? { count: overdueBadgeCount, suffix: "overdue", tone: "red" as const }
        : href === "/bookings" && dueTodayBadgeCount > 0
        ? { count: dueTodayBadgeCount, suffix: "due today", tone: "orange" as const }
        : attentionCounts?.[href]?.count
        ? { count: attentionCounts[href]!.count, suffix: attentionCounts[href]!.suffix, tone: "quiet" as const }
        : null;
    const badgeCount = badgeCfg?.count ?? 0;
    const badgeLabel = item.badge;
    const tooltipBase = badgeCfg
      ? `${item.label} · ${badgeCfg.count} ${badgeCfg.suffix}`
      : item.label;

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
              "top-1/2! right-1.5 h-[18px] min-w-[18px] -translate-y-1/2 rounded-full pb-px text-[11px] font-bold leading-none tabular-nums group-data-[collapsible=icon]:top-1! group-data-[collapsible=icon]:right-1 group-data-[collapsible=icon]:size-2 group-data-[collapsible=icon]:min-w-0 group-data-[collapsible=icon]:translate-y-0 group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:text-transparent",
              // Lato's digits sit low in their line box; pb-px centers them. One digit gets a true circle.
              badgeCount > 9 ? "px-1.5" : "w-[18px] px-0",
              badgeCfg?.tone === "orange"
                ? "bg-[var(--orange-bg)] text-[color:var(--orange-text)]"
                : badgeCfg?.tone === "quiet"
                  ? "bg-[var(--sidebar-active)] font-semibold text-[color:var(--sidebar-text)] group-data-[collapsible=icon]:bg-[var(--sidebar-muted)]"
                  : "bg-[var(--wi-red)] text-white",
            )}
          >
            <span className="sr-only">
              {badgeCfg!.count} {badgeCfg!.suffix}
            </span>
            <span aria-hidden="true">{badgeCount > 99 ? "99+" : badgeCount}</span>
          </SidebarMenuBadge>
        )}
        {!badgeCount && badgeLabel && (
          <SidebarMenuBadge className={cn("top-1/2! h-4 -translate-y-1/2 rounded bg-[var(--sidebar-hover)] px-1 text-[10px] font-medium text-[color:var(--sidebar-muted)]")}>
            {badgeLabel}
          </SidebarMenuBadge>
        )}
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
                    isActive={isOnAccountPage}
                    className={cn(
                      "h-11 gap-2.5 rounded-md px-1.5 text-[color:var(--sidebar-text-active)] hover:bg-[var(--sidebar-hover)] hover:text-[color:var(--sidebar-text-active)] data-[state=open]:bg-[var(--sidebar-active)] data-[state=open]:hover:bg-[var(--sidebar-active)] data-[state=open]:hover:text-[color:var(--sidebar-text-active)] group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:rounded-full",
                      "data-[active=true]:bg-[var(--sidebar-active)] data-[active=true]:font-normal data-[active=true]:text-[color:var(--sidebar-text-active)]",
                    )}
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
                  side={isMobile ? "top" : "right"}
                  align="end"
                  sideOffset={8}
                  className={cn(lato.className, "w-[17rem] rounded-xl p-1.5")}
                >
                  <DropdownMenuLabel className="flex items-center gap-2.5 px-2 py-2 font-normal">
                    <UserAvatar name={user.name} avatarUrl={user.avatarUrl} className="size-9" />
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-bold leading-tight text-foreground">{user.name}</p>
                      <p className="mt-0.5 truncate text-[12px] leading-tight text-muted-foreground">{user.email}</p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="my-1.5" />
                  <DropdownMenuItem asChild className={menuItemClass}>
                    <Link prefetch={false} href={SETTINGS_HREF}>
                      <SettingsIcon />
                      Settings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className={menuItemClass}>
                    <Link prefetch={false} href={`/staff/${user.id}`}>
                      <UserIcon />
                      Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem className={menuItemClass} onSelect={() => setCustomizeOpen(true)}>
                    <PinIcon />
                    Customize sidebar
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="my-1.5" />
                  <div className="px-2 pb-1.5 pt-1" onPointerDown={(event) => event.preventDefault()}>
                    <p className="mb-1.5 text-[12px] font-bold text-muted-foreground">Appearance</p>
                    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-0.5 rounded-lg bg-muted p-0.5">
                      {THEME_CHOICES.map((choice) => {
                        const ThemeIcon = choice === "light" ? SunIcon : choice === "dark" ? MoonIcon : MonitorIcon;
                        const selected = theme === choice;
                        return (
                          <button
                            key={choice}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => setTheme(choice)}
                            className={cn(
                              "flex h-8 items-center justify-center gap-1.5 rounded-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                              selected && "bg-card text-foreground shadow-xs",
                            )}
                          >
                            <ThemeIcon className="size-3.5" aria-hidden="true" />
                            <span className="text-[12.5px] capitalize">{choice}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <DropdownMenuSeparator className="my-1.5" />
                  <DropdownMenuItem asChild className={menuItemClass}>
                    <a href="mailto:erole@athletics.wisc.edu?subject=Wisconsin%20Creative%20help">
                      <LifeBuoyIcon />
                      Help and feedback
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={cn(menuItemClass, "cursor-pointer")}
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
          <SidebarCustomizeDialog
            open={customizeOpen}
            onOpenChange={setCustomizeOpen}
            groups={visibleGroups}
            pinnedHrefs={pinnedHrefs}
            onPinnedChange={setPinnedHrefs}
            className={lato.className}
          />
        </SidebarFooter>
      )}
      </div>
    </Sidebar>
  );
}
