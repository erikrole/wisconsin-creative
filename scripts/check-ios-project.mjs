#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const iosDir = join(root, "ios");
const checkedProject = join(iosDir, "Wisconsin.xcodeproj", "project.pbxproj");
const checkedEntitlements = join(iosDir, "Wisconsin", "Wisconsin.entitlements");

function read(path) {
  return readFileSync(path, "utf8");
}

function assertExists(path, label) {
  if (!existsSync(path)) {
    console.error(`Missing ${label}: ${path}`);
    process.exit(1);
  }
}

assertExists(join(iosDir, "project.yml"), "XcodeGen project.yml");
assertExists(checkedProject, "checked-in Xcode project");
assertExists(checkedEntitlements, "checked-in entitlements");

const workDir = mkdtempSync(join(tmpdir(), "gear-tracker-ios-project-"));

try {
  cpSync(join(iosDir, "project.yml"), join(workDir, "project.yml"));
  cpSync(join(iosDir, "Wisconsin"), join(workDir, "Wisconsin"), { recursive: true });
  cpSync(join(iosDir, "IconSources", "KioskIcon.icon"), join(workDir, "IconSources", "KioskIcon.icon"), { recursive: true });
  if (existsSync(join(iosDir, "WisconsinLiveActivities"))) {
    cpSync(join(iosDir, "WisconsinLiveActivities"), join(workDir, "WisconsinLiveActivities"), { recursive: true });
  }
  if (existsSync(join(iosDir, "WisconsinTests"))) {
    cpSync(join(iosDir, "WisconsinTests"), join(workDir, "WisconsinTests"), { recursive: true });
  }
  if (existsSync(join(iosDir, "WisconsinUITests"))) {
    cpSync(join(iosDir, "WisconsinUITests"), join(workDir, "WisconsinUITests"), { recursive: true });
  }
  if (existsSync(join(iosDir, "WisconsinKioskTests"))) {
    cpSync(join(iosDir, "WisconsinKioskTests"), join(workDir, "WisconsinKioskTests"), { recursive: true });
  }

  execFileSync("xcodegen", ["generate"], {
    cwd: workDir,
    stdio: "pipe",
  });

  const generatedProject = join(workDir, "Wisconsin.xcodeproj", "project.pbxproj");
  const generatedEntitlements = join(workDir, "Wisconsin", "Wisconsin.entitlements");
  assertExists(generatedProject, "generated Xcode project");
  assertExists(generatedEntitlements, "generated entitlements");

  const mismatches = [];
  if (read(generatedProject) !== read(checkedProject)) {
    mismatches.push("ios/Wisconsin.xcodeproj/project.pbxproj");
  }
  if (read(generatedEntitlements) !== read(checkedEntitlements)) {
    mismatches.push("ios/Wisconsin/Wisconsin.entitlements");
  }

  // Schemes carry launch, profiling, and coverage settings too.
  for (const scheme of ["Wisconsin", "WisconsinPerformance", "WisconsinKiosk"]) {
    const relative = join("Wisconsin.xcodeproj", "xcshareddata", "xcschemes", `${scheme}.xcscheme`);
    assertExists(join(iosDir, relative), `checked-in ${scheme} scheme`);
    assertExists(join(workDir, relative), `generated ${scheme} scheme`);
    if (read(join(iosDir, relative)) !== read(join(workDir, relative))) {
      mismatches.push(`ios/${relative}`);
    }
  }

  if (mismatches.length > 0) {
    console.error("XcodeGen output differs from checked-in files:");
    for (const file of mismatches) console.error(`  ${file}`);
    console.error("Run `cd ios && xcodegen generate`, review the diff, then commit the intentional changes.");
    process.exit(1);
  }

  console.log("OK: XcodeGen output matches checked-in iOS project files");
} catch (error) {
  if (error.code === "ENOENT") {
    console.error("xcodegen is not installed. Install it with `brew install xcodegen`.");
    process.exit(1);
  }
  if (error.status !== undefined) {
    const stderr = error.stderr?.toString().trim();
    if (stderr) console.error(stderr);
    process.exit(error.status);
  }
  throw error;
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
