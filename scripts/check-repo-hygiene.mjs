// Fails when images or video are tracked at the repository root. Review
// screenshots belong on a scratch/<topic>-shots branch or under design-qa/.
import { execFileSync } from "node:child_process";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0");
const offenders = tracked.filter((f) => f && !f.includes("/") && /\.(png|jpe?g|gif|webp|mp4|mov|zip)$/i.test(f));

if (offenders.length > 0) {
  console.error("Root-level media is not allowed. Move these under design-qa/ or a scratch branch:");
  for (const f of offenders) console.error(`  ${f}`);
  process.exit(1);
}
console.log("Repo hygiene: no root-level media.");
