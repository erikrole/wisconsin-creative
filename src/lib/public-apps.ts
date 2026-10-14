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
    summary:
      "Turns Wisconsin radio broadcasts into highlight clips. Radio transcribes the game, matches it to the official play-by-play, and exports the clips you approve as MP3.",
    highlights: [
      "Broadcast transcription and play-by-play matching",
      "Listening review before anything is exported",
      "MP3 export for each approved clip",
    ],
  },
];

export const publicTools: PublicTool[] = [
  {
    name: "QR Studio",
    summary:
      "Branded QR codes for links, Wi-Fi, contacts, and more, checked to scan before you export. Runs entirely in your browser.",
    status: "live",
    statusLabel: "Live",
    href: "/qrcode",
    hrefLabel: "Open QR Studio",
  },
  {
    name: "Golden Hour",
    summary: "When the light is good today at Camp Randall or any Big Ten road venue, in local time.",
    status: "coming-soon",
    statusLabel: "Coming soon",
  },
  {
    name: "Timelapse",
    summary: "Frame rate or interval, roll time, and clip length for the FX3, A1, A1 II, A7 V, and A9 III.",
    status: "coming-soon",
    statusLabel: "Coming soon",
  },
  {
    name: "Board Sizes",
    summary: "Every board, ribbon, table, and IPTV canvas at five venues, with zones, delivery specs, and guide PNGs.",
    status: "coming-soon",
    statusLabel: "Coming soon",
  },
];
