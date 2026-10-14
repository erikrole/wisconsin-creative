export type AppStatus = "available" | "team-beta" | "coming-soon";

export type PublicApp = {
  name: string;
  platform: string;
  status: AppStatus;
  statusLabel: string;
  summary: string;
  highlights: string[];
  href?: string;
  hrefLabel?: string;
};

export type PublicTool = {
  name: string;
  summary: string;
  status: "live" | "coming-soon";
  statusLabel: string;
  href?: string;
  hrefLabel?: string;
};

export const publicApps: PublicApp[] = [
  {
    name: "Wisconsin Creative",
    platform: "iPhone and iPad",
    status: "available",
    statusLabel: "Invite only",
    summary:
      "The team's gear, Schedule, and notifications app. Reserve gear, check your shifts, and look up equipment from the field.",
    highlights: [
      "Reserve gear and see what is ready for pickup",
      "Event schedule, shifts, and call times",
      "Push notifications for handoffs and changes",
    ],
    href: "/about",
    hrefLabel: "See how it works",
  },
  {
    name: "Offload",
    platform: "Mac",
    status: "team-beta",
    statusLabel: "Team beta",
    summary:
      "Card ingest for Sony FX6 and FX3 footage. Offload copies cards, keeps the clips marked OK, matches them to the game's play-by-play, and renames them for editing.",
    highlights: [
      "Verified card copy that never touches the original card",
      "Clip review using the camera's OK flag",
      "Play-by-play matching and consistent clip names",
    ],
  },
  {
    name: "Radio",
    platform: "Mac",
    status: "coming-soon",
    statusLabel: "Coming soon",
    summary: "Clip and share radio broadcast moments. Details will land here when it is ready.",
    highlights: [],
  },
];

export const publicTools: PublicTool[] = [
  {
    name: "QR Studio",
    summary:
      "Branded, scan-checked QR codes for links, Wi-Fi, email, phone, SMS, contacts, and text. Runs entirely in your browser.",
    status: "live",
    statusLabel: "Live",
    href: "/qrcode",
    hrefLabel: "Open QR Studio",
  },
  {
    name: "Golden Hour",
    summary: "Sunrise, sunset, and golden hour times for planning outdoor shoots.",
    status: "coming-soon",
    statusLabel: "Coming soon",
  },
];
