import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "docs", "CODEMAPS");
const CHECK = process.argv.includes("--check");

const SKIP_DIRS = new Set([
  ".git",
  ".next",
  ".vercel",
  "node_modules",
  ".claude",
  ".codex",
  ".agents",
]);

function rel(filePath) {
  return path.relative(ROOT, filePath).replaceAll(path.sep, "/");
}

function readJson(filePath) {
  return JSON.parse(readFileSync(path.join(ROOT, filePath), "utf8"));
}

function walk(dir, predicate = () => true) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      out.push(...walk(full, predicate));
    } else if (predicate(full)) {
      out.push(full);
    }
  }
  return out.sort((a, b) => rel(a).localeCompare(rel(b)));
}

function readIfExists(filePath) {
  const full = path.join(ROOT, filePath);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

function stripRouteGroups(parts) {
  return parts.filter((part) => !(part.startsWith("(") && part.endsWith(")")));
}

function routePathFromAppFile(filePath, marker) {
  const relative = rel(filePath).replace(/^src\/app\//, "");
  const parts = relative.split("/");
  parts.pop();
  const routeParts = stripRouteGroups(parts);
  const route = `/${routeParts.join("/")}`.replace(/\/+/g, "/");
  if (marker === "page" && route === "/") return "/";
  return route;
}

function routeName(filePath) {
  const name = path.basename(filePath);
  if (name === "page.tsx") return routePathFromAppFile(filePath, "page");
  if (name === "layout.tsx") return routePathFromAppFile(filePath, "layout");
  if (name === "route.ts") return routePathFromAppFile(filePath, "route");
  return rel(filePath);
}

function appFiles(name) {
  return walk(path.join(ROOT, "src", "app"), (file) => path.basename(file) === name);
}

function sourceFiles(dir) {
  const full = path.join(ROOT, dir);
  if (!existsSync(full)) return [];
  return walk(full, (file) => /\.(ts|tsx|swift|mjs|js|md)$/.test(file));
}

function lineCount(filePath) {
  return readFileSync(filePath, "utf8").split(/\r?\n/).length;
}

function topFiles(files, limit = 20) {
  return files
    .map((file) => ({ file: rel(file), lines: lineCount(file) }))
    .sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file))
    .slice(0, limit);
}

function parseSchema() {
  const text = readIfExists("prisma/schema.prisma");
  const blocks = [];
  const blockRegex = /^(model|enum)\s+(\w+)\s+\{([\s\S]*?)^\}/gm;
  let match;
  while ((match = blockRegex.exec(text)) !== null) {
    const [, kind, name, body] = match;
    const lines = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("//"));
    if (kind === "enum") {
      blocks.push({ kind, name, values: lines.filter((line) => !line.startsWith("@@")) });
    } else {
      const fields = lines.filter((line) => !line.startsWith("@@"));
      const indexes = lines.filter((line) => line.startsWith("@@"));
      blocks.push({ kind, name, fields, indexes });
    }
  }
  return blocks;
}

function packageRows(deps) {
  return Object.entries(deps ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, version]) => `| \`${name}\` | \`${version}\` |`)
    .join("\n");
}

function envRows() {
  const text = readIfExists(".env.example");
  const names = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => line.split("=")[0])
    .filter(Boolean)
    .sort();
  return names.map((name) => `- \`${name}\``).join("\n");
}

function groupApiRoutes(routes) {
  const groups = new Map();
  for (const route of routes) {
    const parts = route.split("/").filter(Boolean);
    const key = parts.length >= 2 ? `/${parts[0]}/${parts[1]}` : route;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(route);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function areaSlugFromDoc(filePath) {
  return path
    .basename(filePath, ".md")
    .replace(/^AREA_/, "")
    .toLowerCase()
    .replaceAll("_", "-");
}

const AREA_HINTS = {
  badges: ["badges"],
  "bulk-inventory": ["bulk-skus", "bulk-inventory", "batteries"],
  checkouts: ["checkouts"],
  dashboard: ["dashboard"],
  events: ["events", "calendar-events"],
  importer: ["import"],
  items: ["items", "assets"],
  kiosk: ["kiosk"],
  kits: ["kits"],
  licenses: ["licenses"],
  mobile: ["ios", "Wisconsin"],
  notifications: ["notifications"],
  reports: ["reports", "audit"],
  reservations: ["reservations", "bookings"],
  resources: ["resources"],
  scan: ["scan"],
  search: ["search"],
  settings: ["settings"],
  shifts: ["shifts", "schedule", "shift-"],
  users: ["users", "profile", "allowed-emails", "onboarding"],
};

function matchesHints(value, hints) {
  return hints.some((hint) => value.toLowerCase().includes(hint.toLowerCase()));
}

function renderGeneratedNote(title) {
  return `<!-- Generated by scripts/generate-codemaps.mjs. Do not edit by hand. -->\n# ${title}\n`;
}

function renderArchitecture({ pages, layouts, apiRoutes, services, components, tests, largestSourceFiles }) {
  const largestRows = largestSourceFiles
    .map(({ file, lines }) => `| \`${file}\` | ${lines} |`)
    .join("\n");

  return `${renderGeneratedNote("Architecture Overview")}
## System Type

Wisconsin Creative is a Next.js App Router application with a companion native iOS app under \`ios/\`. The web app deploys to Vercel Node.js serverless functions and uses Prisma with Neon PostgreSQL.

## Current Source Shape

| Surface | Count |
|---|---:|
| App pages | ${pages.length} |
| App layouts | ${layouts.length} |
| API route handlers | ${apiRoutes.length} |
| Service files | ${services.length} |
| Component files | ${components.length} |
| Test files | ${tests.length} |

## Oversized Source Watchlist

Informational only. These are the largest TypeScript and TSX files under \`src/\`; line count is not a failure threshold.

| File | Lines |
|---|---:|
${largestRows || "| _none_ | 0 |"}

## High-Level Data Flow

\`\`\`
Browser / Kiosk / iOS app
  -> Next.js App Router pages and route handlers
  -> src/lib services, auth, RBAC, validation, audit, storage
  -> Prisma ORM
  -> Neon PostgreSQL

External services:
  -> Vercel Blob for images and uploads
  -> Resend for transactional email
  -> Sentry for error tracking
  -> Vercel Cron for scheduled maintenance
\`\`\`

## Primary Directories

| Path | Purpose |
|---|---|
| \`src/app/\` | App Router pages, layouts, and API route handlers |
| \`src/components/\` | Shared React components and shadcn/ui primitives |
| \`src/lib/\` | Server services, API helpers, auth, domain logic, storage, notification logic |
| \`prisma/\` | Prisma schema, migrations, and seed script |
| \`ios/\` | Native Wisconsin iOS app |
| \`docs/\` | Product, area, architecture, and runbook docs |
| \`tasks/\` | Active task ledgers, plans, reviews, and archived proof artifacts |
| \`plans/\` | Executor-ready implementation plans from audit workflows |
| \`tests/\` | Vitest coverage for API contracts, services, source contracts, and regressions |

## Verification Entry Points

- \`npm run test\`
- \`npx tsc --noEmit\`
- \`npm run db:migrate:check\`
- \`npm run drift:ios\`
- \`npm run audit:ios:gaps\`
- \`git diff --check\`
- \`npm run codemap:check\`
`;
}

function renderBackend({ apiRoutes, services, libFiles }) {
  const serviceRows = services
    .map((file) => `| \`${rel(file)}\` | ${lineCount(file)} |`)
    .join("\n");
  const libRows = libFiles
    .map((file) => `| \`${rel(file)}\` | ${lineCount(file)} |`)
    .join("\n");
  const apiGroups = groupApiRoutes(apiRoutes.map((file) => routeName(file)))
    .map(([group, routes]) => `### \`${group}\`\n\n${routes.map((route) => `- \`${route}\``).join("\n")}`)
    .join("\n\n");

  return `${renderGeneratedNote("Backend Map")}
## Service Layer

| File | Lines |
|---|---:|
${serviceRows || "| _none_ | 0 |"}

## Key Library Files

| File | Lines |
|---|---:|
${libRows || "| _none_ | 0 |"}

## API Route Groups

${apiGroups}
`;
}

function renderFrontend({ pages, layouts, components, hooks }) {
  const pageRows = pages.map((file) => `| \`${routeName(file)}\` | \`${rel(file)}\` |`).join("\n");
  const layoutRows = layouts.map((file) => `| \`${routeName(file)}\` | \`${rel(file)}\` |`).join("\n");
  const componentRows = topFiles(components, 30).map(({ file, lines }) => `| \`${file}\` | ${lines} |`).join("\n");
  const hookRows = hooks.map((file) => `| \`${rel(file)}\` | ${lineCount(file)} |`).join("\n");

  return `${renderGeneratedNote("Frontend Map")}
## Pages

| Route | File |
|---|---|
${pageRows || "| _none_ | _none_ |"}

## Layouts

| Route | File |
|---|---|
${layoutRows || "| _none_ | _none_ |"}

## Largest Components

| File | Lines |
|---|---:|
${componentRows || "| _none_ | 0 |"}

## Hooks

| File | Lines |
|---|---:|
${hookRows || "| _none_ | 0 |"}
`;
}

function renderData(schemaBlocks) {
  const enums = schemaBlocks.filter((block) => block.kind === "enum");
  const models = schemaBlocks.filter((block) => block.kind === "model");
  const enumText = enums
    .map((block) => `### \`${block.name}\`\n\n${block.values.map((value) => `- \`${value}\``).join("\n")}`)
    .join("\n\n");
  const modelRows = models
    .map((block) => `| \`${block.name}\` | ${block.fields.length} | ${block.indexes.length} |`)
    .join("\n");

  return `${renderGeneratedNote("Data Map")}
## Database

- Prisma schema: \`prisma/schema.prisma\`
- Migrations: \`prisma/migrations/\`
- Seed: \`prisma/seed.mjs\`

## Models

| Model | Fields | Model-level indexes/constraints |
|---|---:|---:|
${modelRows || "| _none_ | 0 | 0 |"}

## Enums

${enumText}
`;
}

function renderDependencies(pkg) {
  return `${renderGeneratedNote("Dependency Map")}
## Runtime Dependencies

| Package | Version |
|---|---|
${packageRows(pkg.dependencies)}

## Dev Dependencies

| Package | Version |
|---|---|
${packageRows(pkg.devDependencies)}

## Scripts

${Object.entries(pkg.scripts ?? {})
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, command]) => `- \`${name}\`: \`${command}\``)
  .join("\n")}

## Environment Variables From \`.env.example\`

${envRows() || "- _No .env.example variables found._"}
`;
}

function renderRoutes({ pages, layouts, apiRoutes }) {
  return `${renderGeneratedNote("Route Inventory")}
## Pages

${pages.map((file) => `- \`${routeName(file)}\` -> \`${rel(file)}\``).join("\n")}

## Layouts

${layouts.map((file) => `- \`${routeName(file)}\` -> \`${rel(file)}\``).join("\n")}

## API Routes

${apiRoutes.map((file) => `- \`${routeName(file)}\` -> \`${rel(file)}\``).join("\n")}
`;
}

function renderSchema(schemaBlocks) {
  const blocks = schemaBlocks
    .map((block) => {
      if (block.kind === "enum") {
        return `## Enum \`${block.name}\`\n\nValues: ${block.values.map((value) => `\`${value}\``).join(", ")}`;
      }
      return `## Model \`${block.name}\`\n\nFields: ${block.fields.length}\n\n${block.fields
        .map((field) => `- \`${field}\``)
        .join("\n")}\n\nIndexes and constraints:\n\n${
        block.indexes.length ? block.indexes.map((index) => `- \`${index}\``).join("\n") : "- _None declared at model level._"
      }`;
    })
    .join("\n\n");

  return `${renderGeneratedNote("Schema Inventory")}
${blocks}
`;
}

function renderAreas({ pages, apiRoutes, services, tests }) {
  const docs = walk(path.join(ROOT, "docs"), (file) => /^AREA_.*\.md$/.test(path.basename(file)));
  const rows = docs.map((doc) => {
    const slug = areaSlugFromDoc(doc);
    const hints = AREA_HINTS[slug] ?? [slug];
    const matchedPages = pages.map(routeName).filter((route) => matchesHints(route, hints)).slice(0, 8);
    const matchedApis = apiRoutes.map(routeName).filter((route) => matchesHints(route, hints)).slice(0, 10);
    const matchedServices = services.map(rel).filter((file) => matchesHints(file, hints)).slice(0, 8);
    const matchedTests = tests.map(rel).filter((file) => matchesHints(file, hints)).slice(0, 8);
    return `## ${slug}\n\n- Doc: \`${rel(doc)}\`\n- Pages: ${matchedPages.length ? matchedPages.map((route) => `\`${route}\``).join(", ") : "_none matched_"}\n- APIs: ${matchedApis.length ? matchedApis.map((route) => `\`${route}\``).join(", ") : "_none matched_"}\n- Services: ${matchedServices.length ? matchedServices.map((file) => `\`${file}\``).join(", ") : "_none matched_"}\n- Tests: ${matchedTests.length ? matchedTests.map((file) => `\`${file}\``).join(", ") : "_none matched_"}`;
  });

  return `${renderGeneratedNote("Area Ownership Map")}
This map is heuristic. It links \`docs/AREA_*.md\` files to likely routes, APIs, services, and tests by area keywords. Treat it as a navigation aid, not an authorization or ownership source of truth.

${rows.join("\n\n")}
`;
}

const pkg = readJson("package.json");
const pages = appFiles("page.tsx");
const layouts = appFiles("layout.tsx");
const apiRoutes = appFiles("route.ts");
const services = sourceFiles("src/lib/services").filter((file) => file.endsWith(".ts"));
const libFiles = sourceFiles("src/lib")
  .filter((file) => file.endsWith(".ts") && path.dirname(file) === path.join(ROOT, "src", "lib"))
  .sort((a, b) => rel(a).localeCompare(rel(b)));
const components = sourceFiles("src/components").filter((file) => /\.(ts|tsx)$/.test(file));
const hooks = sourceFiles("src/hooks").filter((file) => /\.(ts|tsx)$/.test(file));
const tests = sourceFiles("tests").filter((file) => file.endsWith(".test.ts"));
const tsSourceFiles = sourceFiles("src").filter((file) => /\.(ts|tsx)$/.test(file));
const schemaBlocks = parseSchema();

const files = new Map([
  [
    "architecture.md",
    renderArchitecture({
      pages,
      layouts,
      apiRoutes,
      services,
      components,
      tests,
      largestSourceFiles: topFiles(tsSourceFiles, 20),
    }),
  ],
  ["backend.md", renderBackend({ apiRoutes, services, libFiles })],
  ["frontend.md", renderFrontend({ pages, layouts, components, hooks })],
  ["data.md", renderData(schemaBlocks)],
  ["dependencies.md", renderDependencies(pkg)],
  ["routes.md", renderRoutes({ pages, layouts, apiRoutes })],
  ["schema.md", renderSchema(schemaBlocks)],
  ["areas.md", renderAreas({ pages, apiRoutes, services, tests })],
]);

mkdirSync(OUT_DIR, { recursive: true });

let drift = false;
for (const [name, content] of files) {
  const target = path.join(OUT_DIR, name);
  if (CHECK) {
    const existing = existsSync(target) ? readFileSync(target, "utf8") : "";
    if (existing !== content) {
      drift = true;
      console.error(`Codemap drift: docs/CODEMAPS/${name}`);
    }
  } else {
    writeFileSync(target, content);
  }
}

if (drift) {
  console.error("Run `npm run codemap` and commit the generated docs.");
  process.exit(1);
}

console.log(CHECK ? "Codemaps are current." : `Generated ${files.size} codemap files.`);
