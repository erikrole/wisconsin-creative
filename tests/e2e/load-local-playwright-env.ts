import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PLAYWRIGHT_ENV_KEYS = [
  "PLAYWRIGHT_EMAIL",
  "PLAYWRIGHT_PASSWORD",
  "PLAYWRIGHT_ROLE",
  "PLAYWRIGHT_BASE_URL",
  "PLAYWRIGHT_TARGET_ISOLATED",
  "PLAYWRIGHT_RELEASE",
  "PLAYWRIGHT_PRODUCTION_HOSTS",
] as const;

function readDotenvValue(contents: string, key: string) {
  const keyPattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.*)$`, "m");
  const match = contents.match(keyPattern);
  if (!match) return undefined;

  const value = match[1]?.trim() ?? "";
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function loadLocalPlaywrightEnv({
  rootDir = process.cwd(),
  environment = process.env,
}: {
  rootDir?: string;
  environment?: NodeJS.ProcessEnv;
} = {}) {
  if (environment.CI !== undefined) return { status: "skipped" as const, reason: "ci" };

  const filePath = join(rootDir, ".env.development.local");
  if (!existsSync(filePath)) return { status: "missing" as const };

  const contents = readFileSync(filePath, "utf8");
  let applied = 0;
  for (const key of PLAYWRIGHT_ENV_KEYS) {
    if (environment[key]) continue;
    const value = readDotenvValue(contents, key);
    if (value === undefined || value === "") continue;
    environment[key] = value;
    applied += 1;
  }
  return { status: applied > 0 ? "applied" as const : "unchanged" as const, applied };
}
