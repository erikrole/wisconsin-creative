import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
export function localChecksums() {
  return Object.fromEntries(readdirSync("prisma/migrations", { withFileTypes: true }).filter((e) => e.isDirectory()).map(({ name }) => [name,
    createHash("sha256").update(readFileSync(`prisma/migrations/${name}/migration.sql`)).digest("hex")]));
}
