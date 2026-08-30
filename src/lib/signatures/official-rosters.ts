import {
  normalizeSignatureName,
  SIGNATURE_MENS_HOCKEY_SPORT_CODE,
  signatureRosterEntrySchema,
  type SignatureImportedSportCode,
  type SignatureRosterEntry,
} from "./types";

const MHKY_2026_27_SOURCE_URL = "https://uwbadgers.com/sports/mens-ice-hockey/roster/2026-27";

type OfficialPlayerSeed = {
  sourceExternalId: string;
  jerseyNumber: number;
  name: string;
  position: "Defenseman" | "Forward" | "Goaltender";
  academicYear: "Freshman" | "Sophomore" | "Junior" | "Senior";
  hometown: string;
};

const MHKY_2026_27_PLAYERS: OfficialPlayerSeed[] = [
  { sourceExternalId: "mhky-2026-27-02-luke-osburn", jerseyNumber: 2, name: "Luke Osburn", position: "Defenseman", academicYear: "Sophomore", hometown: "Plymouth, Mich." },
  { sourceExternalId: "mhky-2026-27-03-brent-solomon", jerseyNumber: 3, name: "Brent Solomon", position: "Forward", academicYear: "Freshman", hometown: "Champlin, Minn." },
  { sourceExternalId: "mhky-2026-27-04-dylan-compton", jerseyNumber: 4, name: "Dylan Compton", position: "Defenseman", academicYear: "Sophomore", hometown: "Victoria, B.C." },
  { sourceExternalId: "mhky-2026-27-05-zach-schulz", jerseyNumber: 5, name: "Zach Schulz", position: "Defenseman", academicYear: "Senior", hometown: "South Lyon, Mich." },
  { sourceExternalId: "mhky-2026-27-06-logan-hensler", jerseyNumber: 6, name: "Logan Hensler", position: "Defenseman", academicYear: "Junior", hometown: "Woodbury, Minn." },
  { sourceExternalId: "mhky-2026-27-07-gavin-morrissey", jerseyNumber: 7, name: "Gavin Morrissey", position: "Forward", academicYear: "Junior", hometown: "Rochester Hills, Mich." },
  { sourceExternalId: "mhky-2026-27-08-jack-phelan", jerseyNumber: 8, name: "Jack Phelan", position: "Defenseman", academicYear: "Junior", hometown: "Hinsdale, Ill." },
  { sourceExternalId: "mhky-2026-27-09-chase-jette", jerseyNumber: 9, name: "Chase Jette", position: "Forward", academicYear: "Freshman", hometown: "Lake Forest, Ill." },
  { sourceExternalId: "mhky-2026-27-12-gavin-uhlenkamp", jerseyNumber: 12, name: "Gavin Uhlenkamp", position: "Forward", academicYear: "Freshman", hometown: "Chanhassen, Minn." },
  { sourceExternalId: "mhky-2026-27-14-joe-palodichuk", jerseyNumber: 14, name: "Joe Palodichuk", position: "Defenseman", academicYear: "Senior", hometown: "Cottage Grove, Minn." },
  { sourceExternalId: "mhky-2026-27-17-grady-deering", jerseyNumber: 17, name: "Grady Deering", position: "Forward", academicYear: "Sophomore", hometown: "Des Moines, Iowa" },
  { sourceExternalId: "mhky-2026-27-18-adam-pietila", jerseyNumber: 18, name: "Adam Pietila", position: "Forward", academicYear: "Junior", hometown: "Hartland, Mich." },
  { sourceExternalId: "mhky-2026-27-19-zach-wooten", jerseyNumber: 19, name: "Zach Wooten", position: "Forward", academicYear: "Freshman", hometown: "Apple Valley, Minn." },
  { sourceExternalId: "mhky-2026-27-21-ryan-botterill", jerseyNumber: 21, name: "Ryan Botterill", position: "Forward", academicYear: "Junior", hometown: "Portage la Prairie, Man." },
  { sourceExternalId: "mhky-2026-27-23-john-stout", jerseyNumber: 23, name: "John Stout", position: "Defenseman", academicYear: "Freshman", hometown: "Minnetonka, Minn." },
  { sourceExternalId: "mhky-2026-27-24-talan-blanck", jerseyNumber: 24, name: "Talan Blanck", position: "Forward", academicYear: "Freshman", hometown: "Fond du Lac, Wis." },
  { sourceExternalId: "mhky-2026-27-26-weston-knox", jerseyNumber: 26, name: "Weston Knox", position: "Defenseman", academicYear: "Junior", hometown: "Andover, Minn." },
  { sourceExternalId: "mhky-2026-27-27-finn-brink", jerseyNumber: 27, name: "Finn Brink", position: "Forward", academicYear: "Sophomore", hometown: "Maple Grove, Minn." },
  { sourceExternalId: "mhky-2026-27-30-alexis-cournoyer", jerseyNumber: 30, name: "Alexis Cournoyer", position: "Goaltender", academicYear: "Sophomore", hometown: "Trois-Rivières, Quebec" },
  { sourceExternalId: "mhky-2026-27-31-daniel-hauser", jerseyNumber: 31, name: "Daniel Hauser", position: "Goaltender", academicYear: "Sophomore", hometown: "Chestermere, Alberta" },
  { sourceExternalId: "mhky-2026-27-35-xander-miceli", jerseyNumber: 35, name: "Xander Miceli", position: "Goaltender", academicYear: "Freshman", hometown: "Nashville, Tenn." },
  { sourceExternalId: "mhky-2026-27-55-oliver-tulk", jerseyNumber: 55, name: "Oliver Tulk", position: "Forward", academicYear: "Sophomore", hometown: "Gibsons, B.C." },
  { sourceExternalId: "mhky-2026-27-57-eetu-orpana", jerseyNumber: 57, name: "Eetu Orpana", position: "Forward", academicYear: "Freshman", hometown: "Lempäälä, Finland" },
  { sourceExternalId: "mhky-2026-27-86-jj-wiebusch", jerseyNumber: 86, name: "JJ Wiebusch", position: "Forward", academicYear: "Junior", hometown: "Verona, Wis." },
  { sourceExternalId: "mhky-2026-27-91-bruno-idzan", jerseyNumber: 91, name: "Bruno Idžan", position: "Forward", academicYear: "Sophomore", hometown: "Zagreb, Croatia" },
  { sourceExternalId: "mhky-2026-27-94-vasily-zelenov", jerseyNumber: 94, name: "Vasily Zelenov", position: "Forward", academicYear: "Sophomore", hometown: "Moscow, Russia" },
];

const MHKY_2026_27_ENTRIES = signatureRosterEntrySchema.array().parse(
  MHKY_2026_27_PLAYERS.map((player) => ({
    sourceExternalId: player.sourceExternalId,
    sourceProfileUrl: MHKY_2026_27_SOURCE_URL,
    name: player.name,
    normalizedName: normalizeSignatureName(player.name),
    jerseyNumber: player.jerseyNumber,
    roleGroup: "PLAYER" as const,
    title: `${player.position} • ${player.academicYear}`,
    hometown: player.hometown,
  })),
);

export type OfficialSignatureRosterSeed = {
  sourceKey: string;
  sourceUrl: string;
  parserVersion: string;
  entries: SignatureRosterEntry[];
};

export function getOfficialSignatureRosterSeed(
  sportCode: SignatureImportedSportCode,
  season: string,
): OfficialSignatureRosterSeed | null {
  if (sportCode !== SIGNATURE_MENS_HOCKEY_SPORT_CODE || season !== "2026-27") return null;

  return {
    sourceKey: "UW_BADGERS_MHKY_FACT_BOOK",
    sourceUrl: MHKY_2026_27_SOURCE_URL,
    parserVersion: "uwbadgers-mhky-factbook-2026-27-v1",
    entries: MHKY_2026_27_ENTRIES.map((entry) => ({ ...entry })),
  };
}
