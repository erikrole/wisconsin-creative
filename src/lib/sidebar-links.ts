import type { ElementType } from "react";
import { CloudDownloadIcon, HardDriveDownloadIcon, SmartphoneIcon } from "lucide-react";

/** One of our own apps in the sidebar's Apps flyout. Quick links live in the database (src/lib/quick-links.ts). */
export type SidebarLink = {
  label: string;
  href: string;
  icon: ElementType;
  /** One short line under the label. */
  detail?: string;
  /** Roles that see the link; omit for everyone who is signed in. */
  roles?: readonly string[];
};

/** Our own apps, shown above the browser tools in the sidebar's Apps flyout. Their pages on /apps are public. */
export const SIDEBAR_APPS: readonly SidebarLink[] = [
  { label: "Wisconsin Creative", detail: "iPhone and iPad app", href: "https://apps.apple.com/us/app/wisconsin-creative/id6763456945", icon: SmartphoneIcon },
  { label: "Offload", detail: "FX6 and FX3 card offload, Mac", href: "/apps/offload", icon: HardDriveDownloadIcon },
  { label: "Fetch", detail: "Download and convert media, Mac", href: "/apps/fetch", icon: CloudDownloadIcon },
];

export function linksForRole(role: string | undefined, links: readonly SidebarLink[]): SidebarLink[] {
  return links.filter((link) => !link.roles || (role !== undefined && link.roles.includes(role)));
}

/** Links that leave wisconsincreative.com open in a new tab. */
export function isExternal(href: string) {
  return /^https?:\/\//.test(href);
}
