import type { ElementType } from "react";
import { FrameIcon, QrCodeIcon, RulerIcon, SunriseIcon, TimerIcon } from "lucide-react";

/** The browser tools listed in the sidebar's Tools flyout. Add a new tool here and it appears for everyone it is allowed for. */
export type WebTool = {
  label: string;
  /** Public path of the static tool (served from public/<tool>/). */
  href: string;
  icon: ElementType;
  /** Roles that see the tool; omit for everyone who is signed in. */
  roles?: readonly string[];
};

// The tools are public pages with no team data, so by default every role (collaborators included) sees them.
export const WEB_TOOLS: readonly WebTool[] = [
  { label: "QR Studio", href: "/qrcode", icon: QrCodeIcon },
  { label: "Board Sizes", href: "/board-sizes", icon: RulerIcon },
  { label: "Golden Hour", href: "/golden-hour", icon: SunriseIcon },
  { label: "Timelapse", href: "/timelapse", icon: TimerIcon },
  { label: "Photo Frame", href: "/frame", icon: FrameIcon },
];

export const ALL_TOOLS_HREF = "/apps";

export function toolsForRole(role: string | undefined, tools: readonly WebTool[] = WEB_TOOLS): WebTool[] {
  return tools.filter((tool) => !tool.roles || (role !== undefined && tool.roles.includes(role)));
}
