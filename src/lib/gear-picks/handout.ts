import { SIZE_NEEDED, participantPieces, studentPieces, type OrderSource, type Piece } from "./order";
import type { GearPickAdminParticipant, GearPickAdminStudent, GearPickHandoutDto } from "./types";

type HandoutPiece = Piece & {
  /** Person, SKU, size and source, the same key the handout record uses. */
  key: string;
  handed: boolean;
  /** A piece with no size on file can't be handed out yet. */
  blocked: boolean;
};

export type HandoutPerson = {
  userId: string;
  name: string;
  group: "Staff" | "Student";
  pieces: HandoutPiece[];
  handedCount: number;
  totalCount: number;
  status: "NONE" | "PARTIAL" | "DONE";
};

type Kits = Parameters<typeof participantPieces>[1];

export const pieceKey = (sku: string, size: string, source: OrderSource) => `${sku}|${size}|${source}`;

function toPerson(userId: string, name: string, group: HandoutPerson["group"], pieces: Piece[], handedKeys: Set<string>): HandoutPerson {
  const rows = pieces.map((piece) => {
    const key = pieceKey(piece.sku, piece.size, piece.source);
    return { ...piece, key, handed: handedKeys.has(key), blocked: piece.size === SIZE_NEEDED };
  });
  const totalCount = rows.reduce((sum, row) => sum + row.quantity, 0);
  const handedCount = rows.filter((row) => row.handed).reduce((sum, row) => sum + row.quantity, 0);
  return { userId, name, group, pieces: rows, handedCount, totalCount, status: handedCount === 0 ? "NONE" : handedCount >= totalCount ? "DONE" : "PARTIAL" };
}

/** Who is owed what, and how much of it has been handed over. Staff first, then students, each by name. */
export function buildHandoutBoard(
  participants: GearPickAdminParticipant[],
  students: GearPickAdminStudent[],
  handouts: Pick<GearPickHandoutDto, "userId" | "sku" | "size" | "source">[],
  kits: Kits,
): HandoutPerson[] {
  const handedByUser = new Map<string, Set<string>>();
  for (const handout of handouts) {
    const keys = handedByUser.get(handout.userId) ?? new Set<string>();
    keys.add(pieceKey(handout.sku, handout.size, handout.source));
    handedByUser.set(handout.userId, keys);
  }
  const none = new Set<string>();
  const people = [
    ...participants.map((person) => toPerson(person.user.id, person.user.name, "Staff", participantPieces(person, kits), handedByUser.get(person.user.id) ?? none)),
    ...students.map((student) => toPerson(student.user.id, student.user.name, "Student", studentPieces(student), handedByUser.get(student.user.id) ?? none)),
  ];
  return people.sort((a, b) => (a.group === b.group ? a.name.localeCompare(b.name) : a.group === "Staff" ? -1 : 1));
}
