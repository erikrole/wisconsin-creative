import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("iOS Xcode verification gate", () => {
  it("runs each scheme's XCTest target on a compatible simulator by default", () => {
    const script = readFileSync("scripts/ios-xcode-verify.sh", "utf8");

    expect(script).toContain('SCHEME="${IOS_SCHEME:-Wisconsin}"');
    expect(script).toContain('if [[ "$SCHEME" == "WisconsinKiosk" ]]');
    expect(script).toContain('SIMULATOR_NAME="${IOS_SIMULATOR_NAME:-iPhone 16 Pro}"');
    expect(script).toContain('SIMULATOR_NAME="${IOS_SIMULATOR_NAME:-iPad (A16)}"');
    expect(script).toContain("resolve_simulator_udid");
    expect(script).toContain("[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}");
    expect(script).toContain("udid = substr(line, RSTART, RLENGTH)");
    expect(script).toContain("IOS_TEST_DESTINATION");
    expect(script).toContain('if [[ "${IOS_SKIP_TESTS:-0}" != "1" ]]');
    expect(script).toContain('run_step "XCTest simulator suite"');
    expect(script).toMatch(/-destination "\$TEST_DESTINATION"[\s\S]*-derivedDataPath "\$DERIVED_DATA_PATH"[\s\S]*test/);
  });
});
