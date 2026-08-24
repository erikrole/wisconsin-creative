import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const API_ROOT = path.join(process.cwd(), "src/app/api");
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;
const WRAPPER_NAMES = ["withAuth", "withKiosk", "withHandler", "withCron"] as const;
const PUBLIC_HANDLER_ROUTES: Record<string, string[]> = {
  "src/app/api/auth/discover/route.ts": ["POST"],
  "src/app/api/auth/forgot-password/route.ts": ["POST"],
  "src/app/api/auth/login/route.ts": ["POST"],
  "src/app/api/auth/passkey/login/options/route.ts": ["POST"],
  "src/app/api/auth/passkey/login/verify/route.ts": ["POST"],
  "src/app/api/auth/register/route.ts": ["POST"],
  "src/app/api/auth/reset-password/route.ts": ["POST"],
  "src/app/api/auth/reset-password/account/route.ts": ["POST"],
  "src/app/api/companion/devices/route.ts": ["POST", "DELETE"],
  "src/app/api/companion/projection/route.ts": ["GET"],
  "src/app/api/companion/session/route.ts": ["POST"],
  "src/app/api/kiosk/activate/route.ts": ["POST"],
  "src/app/api/seed/route.ts": ["POST"],
  "src/app/api/shifts/ics/[token]/route.ts": ["GET"],
};
const PUBLIC_HANDLER_ALLOWLIST = new Set(Object.keys(PUBLIC_HANDLER_ROUTES));
const PUBLIC_ROUTE_SAFETY: Record<string, RegExp[]> = {
  "src/app/api/auth/discover/route.ts": [
    /\b(?:checkRateLimit|enforceRateLimit)\s*\(/,
    /\bgetClientIp\s*\(/,
  ],
  "src/app/api/auth/forgot-password/route.ts": [
    /\b(?:checkRateLimit|enforceRateLimit)\s*\(/,
    /\bgetClientIp\s*\(/,
  ],
  "src/app/api/auth/login/route.ts": [
    /\b(?:checkRateLimit|enforceRateLimit)\s*\(/,
    /\bgetClientIp\s*\(/,
  ],
  "src/app/api/auth/passkey/login/options/route.ts": [
    /\b(?:checkRateLimit|enforceRateLimit)\s*\(/,
    /\bgetClientIp\s*\(/,
  ],
  "src/app/api/auth/passkey/login/verify/route.ts": [
    /\b(?:checkRateLimit|enforceRateLimit)\s*\(/,
    /\bgetClientIp\s*\(/,
  ],
  "src/app/api/auth/register/route.ts": [
    /\b(?:checkRateLimit|enforceRateLimit)\s*\(/,
    /\bgetClientIp\s*\(/,
  ],
  "src/app/api/auth/reset-password/route.ts": [
    /\b(?:checkRateLimit|enforceRateLimit)\s*\(/,
    /\bgetClientIp\s*\(/,
  ],
  "src/app/api/auth/reset-password/account/route.ts": [
    /\b(?:checkRateLimit|enforceRateLimit)\s*\(/,
    /\bgetClientIp\s*\(/,
  ],
  "src/app/api/companion/devices/route.ts": [
    /\brequireCompanion\s*\(/,
    /\b(?:checkRateLimit|enforceRateLimit)\s*\(/,
    /\bgetClientIp\s*\(/,
  ],
  "src/app/api/companion/projection/route.ts": [
    /\brequireCompanion\s*\(/,
    /\b(?:checkRateLimit|enforceRateLimit)\s*\(/,
    /\bgetClientIp\s*\(/,
  ],
  // Renewal authenticates through renewCompanionSession, which calls
  // requireCompanion itself before issuing a replacement token.
  "src/app/api/companion/session/route.ts": [
    /\brenewCompanionSession\s*\(/,
    /\b(?:checkRateLimit|enforceRateLimit)\s*\(/,
    /\bgetClientIp\s*\(/,
  ],
  "src/app/api/kiosk/activate/route.ts": [
    /\b(?:checkRateLimit|enforceRateLimit)\s*\(/,
    /\bgetClientIp\s*\(/,
  ],
  "src/app/api/seed/route.ts": [
    /process\.env\.SEED_ENDPOINT_ENABLED\s*===\s*"true"/,
    /\bwithAuth\s*\(/,
    /\bthrow\s+new\s+HttpError\s*\(\s*404\s*,\s*"Not found"\s*\)/,
  ],
  "src/app/api/shifts/ics/[token]/route.ts": [
    /\bTOKEN_RE\.test\s*\(\s*token\s*\)/,
    /\b(?:checkRateLimit|enforceRateLimit)\s*\(/,
    /\bgetClientIp\s*\(/,
  ],
};

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return routeFiles(fullPath);
    return entry === "route.ts" ? [fullPath] : [];
  });
}

type ExportedMethod = {
  method: string;
  expression: string;
};

function exportedMethods(source: string): ExportedMethod[] {
  const exportPattern = new RegExp(`export\\s+const\\s+(${HTTP_METHODS.join("|")})\\b`, "g");
  return Array.from(source.matchAll(exportPattern)).map((match) => {
    const start = match.index ?? 0;
    const equals = source.indexOf("=", start);
    const expressionStart = equals + 1;
    const expressionEnd = findAssignmentEnd(source, expressionStart);
    return {
      method: match[1]!,
      expression: source.slice(expressionStart, expressionEnd).trim(),
    };
  });
}

function findAssignmentEnd(source: string, start: number) {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let stringQuote: "'" | '"' | "`" | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index]!;
    const next = source[index + 1] ?? "";

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }

    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }

    if (stringQuote) {
      if (char === "\\") {
        index += 1;
        continue;
      }
      if (char === stringQuote) stringQuote = null;
      continue;
    }

    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      stringQuote = char;
      continue;
    }

    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth -= 1;
    if (char === "{") braceDepth += 1;
    if (char === "}") braceDepth -= 1;
    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth -= 1;

    if (char === ";" && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      return index;
    }
  }

  return source.length;
}

function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function expressionForConst(source: string, name: string) {
  const declaration = new RegExp(`\\bconst\\s+${name}\\b`).exec(source);
  if (!declaration) return null;

  const equals = source.indexOf("=", declaration.index);
  if (equals === -1) return null;

  const expressionStart = equals + 1;
  const expressionEnd = findAssignmentEnd(source, expressionStart);
  return source.slice(expressionStart, expressionEnd).trim();
}

function resolvedExpression(source: string, expression: string) {
  const alias = expression.match(/^([A-Za-z_$][\w$]*)$/)?.[1];
  if (!alias) return expression;

  return expressionForConst(source, alias) ?? expression;
}

function wrapperNamesForExpression(expression: string) {
  const names = new Set<(typeof WRAPPER_NAMES)[number]>();
  const comparable = stripComments(expression);

  for (const name of WRAPPER_NAMES) {
    const pattern = new RegExp(`\\b${name}(?:<[^>]+>)?\\s*\\(`);
    if (pattern.test(comparable)) names.add(name);
  }

  return Array.from(names);
}

describe("API route wrapper contract", () => {
  it("keeps the API route inventory discoverable", () => {
    const inventory = routeFiles(API_ROOT).map((file) => path.relative(process.cwd(), file)).sort();
    const missingMethodExports = inventory.filter((file) => exportedMethods(readFileSync(file, "utf8")).length === 0);

    expect(inventory.length).toBeGreaterThan(150);
    expect(missingMethodExports).toEqual([]);
  });

  it("wraps every exported HTTP method with the shared API wrappers", () => {
    const nakedExports = routeFiles(API_ROOT).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return exportedMethods(source)
        .filter(({ expression }) => wrapperNamesForExpression(resolvedExpression(source, expression)).length === 0)
        .map(({ method }) => `${path.relative(process.cwd(), file)}:${method}`);
    });

    expect(nakedExports).toEqual([]);
  });

  it("keeps public, kiosk, and cron wrappers on expected route families", () => {
    const wrapperDrift = routeFiles(API_ROOT).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const relativeFile = path.relative(process.cwd(), file);
      return exportedMethods(source).flatMap(({ method, expression }) => {
        const wrappers = wrapperNamesForExpression(resolvedExpression(source, expression));
        const failures: string[] = [];

        if (wrappers.includes("withHandler") && !PUBLIC_HANDLER_ALLOWLIST.has(relativeFile)) {
          failures.push(`${relativeFile}:${method}:unexpected withHandler`);
        }
        if (wrappers.includes("withKiosk") && !relativeFile.startsWith("src/app/api/kiosk/")) {
          failures.push(`${relativeFile}:${method}:unexpected withKiosk`);
        }
        if (wrappers.includes("withCron") && !relativeFile.startsWith("src/app/api/cron/")) {
          failures.push(`${relativeFile}:${method}:unexpected withCron`);
        }

        return failures;
      });
    });

    expect(wrapperDrift).toEqual([]);
  });

  it("keeps every public withHandler route explicitly allowlisted and abuse-controlled", () => {
    const publicRoutes = routeFiles(API_ROOT).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const relativeFile = path.relative(process.cwd(), file);
      return exportedMethods(source)
        .filter(({ expression }) => wrapperNamesForExpression(resolvedExpression(source, expression)).includes("withHandler"))
        .map(({ method }) => `${relativeFile}:${method}`);
    }).sort();

    const expectedRoutes = Object.entries(PUBLIC_HANDLER_ROUTES)
      .flatMap(([file, methods]) => methods.map((method) => `${file}:${method}`))
      .sort();
    const unsafeRoutes = Array.from(PUBLIC_HANDLER_ALLOWLIST).flatMap((file) => {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      return (PUBLIC_ROUTE_SAFETY[file] ?? [])
        .filter((pattern) => !pattern.test(source))
        .map((pattern) => `${file}:missing ${pattern}`);
    });

    expect(publicRoutes).toEqual(expectedRoutes);
    expect(unsafeRoutes).toEqual([]);
  });
});
