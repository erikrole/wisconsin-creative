const config = {
  appRoot: "/Users/role/Code/wisconsin-creative",
  appPath:
    "/private/tmp/goldie-wisconsin-fixture-build/Build/Products/Release-iphonesimulator/Wisconsin Creative.app",
  bundleId: "com.erikrole.Wisconsin",

  devices: ["iphone-6.9"],
  locales: ["en-US"],
  appearance: "light",

  frame: { variant: "17-pro-silver" },

  theme: {
    background: "#A00000",
    headlineColor: "#FFFFFF",
    subheadColor: "#F7DCE2",
    fontFamily: '"Gotham", sans-serif',
    copyHeightRatio: 0.23,
    deviceWidthRatio: 0.86,
    template: ["hero", "tilt", "offset", "copy-below", "tilt-right"],
    layout: "hero",
  },

  store: {
    name: "Wisconsin Creative",
    subtitle: { "en-US": "Gear and game-day operations" },
    developer: "Wisconsin Athletics Creative",
    category: "Productivity",
    rating: 5,
    ratingCount: "Internal app",
    ageRating: "4+",
    price: "Free",
    description: {
      "en-US":
        "Reserve gear, stay on top of assignments, and keep every game-day handoff clear.",
    },
  },

  scenes: [
    {
      kind: "screenshot",
      id: "home",
      flow: "store-02-home",
      headline: { "en-US": "Know what needs you" },
      subhead: {
        "en-US": "Urgent gear and upcoming work, clear at a glance.",
      },
    },
    {
      kind: "screenshot",
      id: "schedule",
      flow: "store-03-schedule",
      headline: { "en-US": "Game day, organized" },
      subhead: {
        "en-US": "Call times, crews, and assignments stay together.",
      },
    },
    {
      kind: "screenshot",
      id: "items",
      flow: "store-04-items",
      headline: { "en-US": "Find gear fast" },
      subhead: {
        "en-US": "See availability before the handoff starts.",
      },
    },
    {
      kind: "screenshot",
      id: "search",
      flow: "store-05-search",
      headline: { "en-US": "Everything in reach" },
      subhead: {
        "en-US": "Search items, bookings, and people in one place.",
      },
    },
    {
      kind: "screenshot",
      id: "scoreboard",
      flow: "store-06-scoreboard",
      headline: { "en-US": "See your season" },
      subhead: {
        "en-US": "Turn every assignment into a story of the year.",
      },
    },
  ],
};

export default config;
