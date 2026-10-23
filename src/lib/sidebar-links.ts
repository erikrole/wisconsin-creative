import type { ElementType } from "react";
import { CloudDownloadIcon, HardDriveDownloadIcon, MusicIcon, SendIcon, SmartphoneIcon } from "lucide-react";

/** A destination in a sidebar flyout: one of our own apps, or a site the team uses every day. */
export type SidebarLink = {
  label: string;
  href: string;
  icon: ElementType;
  /** One short line under the label. */
  detail?: string;
  /** Roles that see the link; omit for everyone who is signed in. */
  roles?: readonly string[];
};

const INTERNAL = ["ADMIN", "STAFF", "STUDENT"] as const;
const STAFF = ["ADMIN", "STAFF"] as const;
export const ADMIN_ONLY = ["ADMIN"] as const;

/** Our own apps, shown above the browser tools in the sidebar's Apps flyout. Their pages on /apps are public. */
export const SIDEBAR_APPS: readonly SidebarLink[] = [
  { label: "Wisconsin Creative", detail: "iPhone and iPad app", href: "https://apps.apple.com/us/app/wisconsin-creative/id6763456945", icon: SmartphoneIcon },
  { label: "Offload", detail: "FX6 and FX3 card offload, Mac", href: "/apps/offload", icon: HardDriveDownloadIcon },
  { label: "Fetch", detail: "Download and convert media, Mac", href: "/apps/fetch", icon: CloudDownloadIcon },
];

/**
 * Sites the team opens every day, in the sidebar's Quick links flyout. Add a link here and it appears for the
 * roles it names: everyone signed in by default, or e.g. STAFF for staff and admins, ADMIN_ONLY for admins.
 */
export const QUICK_LINKS: readonly SidebarLink[] = [
  { label: "APM Music", detail: "Production music", href: "https://www.apmmusic.com", icon: MusicIcon, roles: INTERNAL },
  { label: "Greenfly", detail: "Send content to athletes", href: "https://app.greenfly.com", icon: SendIcon, roles: STAFF },
];

export function linksForRole(role: string | undefined, links: readonly SidebarLink[]): SidebarLink[] {
  return links.filter((link) => !link.roles || (role !== undefined && link.roles.includes(role)));
}

/** Links that leave wisconsincreative.com open in a new tab. */
export function isExternal(href: string) {
  return /^https?:\/\//.test(href);
}
