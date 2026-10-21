// Display helpers for the owner app activity page. Pure so tests can pin them.

export type ClientPlatform = "web" | "ios" | "macos" | "kiosk";
export type BuildStatus = "latest" | "stale" | "ahead" | "development" | "unknown" | null;

export const PLATFORM_LABELS: Record<ClientPlatform, string> = {
  web: "Web",
  ios: "iPhone",
  macos: "Menu bar",
  kiosk: "Kiosk",
};

/**
 * Categorical platform hues, in fixed order. Validated with the dataviz palette
 * checker: light against the card surface, dark steps against #1a1b1e.
 */
export const PLATFORM_COLORS: Record<ClientPlatform, { light: string; dark: string }> = {
  web: { light: "#3E63DD", dark: "#5F7FE6" },
  ios: { light: "#12A594", dark: "#139E85" },
  macos: { light: "#8E4EC6", dark: "#9D6BD6" },
  kiosk: { light: "#F76B15", dark: "#D66A22" },
};

export const CHANNEL_LABELS: Record<string, string> = {
  app_store: "App Store",
  testflight: "TestFlight",
  development: "Xcode",
  unknown: "Unknown",
  web: "Web",
};

export function channelLabel(channel: string | null): string {
  return channel ? CHANNEL_LABELS[channel] ?? channel : "Unknown";
}

export function versionLabel(version: string | null, build: string | null): string {
  if (version && build) return `${version} (${build})`;
  if (version) return version;
  if (build) return `Build ${build}`;
  return "Unknown version";
}

export function buildStatusLabel(status: BuildStatus): string {
  switch (status) {
    case "latest": return "Current";
    case "stale": return "Behind";
    case "ahead": return "Newer";
    case "development": return "Dev build";
    default: return "Unknown";
  }
}

/** Text-token classes; the dot beside the label carries the hue, never the text alone. */
export function buildStatusTone(status: BuildStatus): { dot: string; text: string } {
  switch (status) {
    case "latest": return { dot: "bg-[var(--green-text)]", text: "text-[var(--green-text)]" };
    case "stale": return { dot: "bg-[var(--orange-text)]", text: "text-[var(--orange-text)]" };
    case "ahead": return { dot: "bg-[var(--blue-text)]", text: "text-[var(--blue-text)]" };
    default: return { dot: "bg-muted-foreground/40", text: "text-muted-foreground" };
  }
}

// Hardware identifiers the iPhone app reports (hw.machine) mapped to marketing names.
const IPHONE_MODELS: Record<string, string> = {
  "iPhone13,1": "iPhone 12 mini",
  "iPhone13,2": "iPhone 12",
  "iPhone13,3": "iPhone 12 Pro",
  "iPhone13,4": "iPhone 12 Pro Max",
  "iPhone14,2": "iPhone 13 Pro",
  "iPhone14,3": "iPhone 13 Pro Max",
  "iPhone14,4": "iPhone 13 mini",
  "iPhone14,5": "iPhone 13",
  "iPhone14,6": "iPhone SE",
  "iPhone14,7": "iPhone 14",
  "iPhone14,8": "iPhone 14 Plus",
  "iPhone15,2": "iPhone 14 Pro",
  "iPhone15,3": "iPhone 14 Pro Max",
  "iPhone15,4": "iPhone 15",
  "iPhone15,5": "iPhone 15 Plus",
  "iPhone16,1": "iPhone 15 Pro",
  "iPhone16,2": "iPhone 15 Pro Max",
  "iPhone17,1": "iPhone 16 Pro",
  "iPhone17,2": "iPhone 16 Pro Max",
  "iPhone17,3": "iPhone 16",
  "iPhone17,4": "iPhone 16 Plus",
  "iPhone17,5": "iPhone 16e",
  "iPhone18,1": "iPhone 17 Pro",
  "iPhone18,2": "iPhone 17 Pro Max",
  "iPhone18,3": "iPhone 17",
  "iPhone18,4": "iPhone Air",
};

export function deviceName(model: string | null): string | null {
  if (!model) return null;
  if (IPHONE_MODELS[model]) return IPHONE_MODELS[model];
  if (model.startsWith("iPad")) return "iPad";
  if (model === "arm64" || model === "x86_64") return "Simulator";
  return model;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase() || "?";
}

/** "Oct 14" style short day for chart axes, from a YYYY-MM-DD key. */
export function shortDay(date: string): string {
  const [year = 1970, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export const SURFACE_LABELS: Record<string, string> = {
  home: "Home",
  bookings: "Bookings",
  items: "Items",
  schedule: "Schedule",
  reports: "Reports",
  settings: "Settings",
  search: "Search",
  notifications: "Notifications",
  users: "Staff",
  scoreboard: "Scoreboard",
  resources: "Resources",
  licenses: "Licenses",
  kiosk: "Kiosk",
  other: "Other pages",
};
