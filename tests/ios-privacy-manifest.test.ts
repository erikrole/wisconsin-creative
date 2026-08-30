import fs from "node:fs";
import path from "node:path";
import { parse } from "plist";
import { describe, expect, it } from "vitest";

const appManifestPath = path.join(process.cwd(), "ios/Wisconsin/Supporting/PrivacyInfo.xcprivacy");
const kioskManifestPath = path.join(process.cwd(), "ios/Wisconsin/KioskOnly/PrivacyInfo.xcprivacy");
const metricKitSourcePath = path.join(process.cwd(), "ios/Wisconsin/Core/PerformanceInstrumentation.swift");

function manifestJson(manifestPath: string) {
  return parse(fs.readFileSync(manifestPath, "utf8")) as {
    NSPrivacyTracking: boolean;
    NSPrivacyTrackingDomains: string[];
    NSPrivacyAccessedAPITypes: Array<{
      NSPrivacyAccessedAPIType: string;
      NSPrivacyAccessedAPITypeReasons: string[];
    }>;
    NSPrivacyCollectedDataTypes: Array<{
      NSPrivacyCollectedDataType: string;
      NSPrivacyCollectedDataTypeLinked: boolean;
      NSPrivacyCollectedDataTypeTracking: boolean;
      NSPrivacyCollectedDataTypePurposes: string[];
    }>;
  };
}

describe("Wisconsin privacy manifest", () => {
  it("matches the source-grounded App Store privacy inventory", () => {
    const manifest = manifestJson(appManifestPath);
    const declared = new Map(manifest.NSPrivacyCollectedDataTypes.map((entry) => [entry.NSPrivacyCollectedDataType, entry]));

    expect(manifest.NSPrivacyTracking).toBe(false);
    expect(manifest.NSPrivacyTrackingDomains).toEqual([]);

    for (const type of [
      "NSPrivacyCollectedDataTypeName",
      "NSPrivacyCollectedDataTypeEmailAddress",
      "NSPrivacyCollectedDataTypePhoneNumber",
      "NSPrivacyCollectedDataTypeUserID",
      "NSPrivacyCollectedDataTypeDeviceID",
      "NSPrivacyCollectedDataTypeOtherUsageData",
      "NSPrivacyCollectedDataTypeOtherDiagnosticData",
      "NSPrivacyCollectedDataTypePhotosorVideos",
      "NSPrivacyCollectedDataTypeOtherUserContent",
      "NSPrivacyCollectedDataTypeOtherDataTypes",
    ]) {
      const entry = declared.get(type);
      expect(entry, `${type} should remain declared`).toBeDefined();
      expect(entry?.NSPrivacyCollectedDataTypeLinked).toBe(true);
      expect(entry?.NSPrivacyCollectedDataTypeTracking).toBe(false);
      expect(entry?.NSPrivacyCollectedDataTypePurposes).toEqual(["NSPrivacyCollectedDataTypePurposeAppFunctionality"]);
    }

    for (const unsupportedType of [
      "NSPrivacyCollectedDataTypeProductInteraction",
      "NSPrivacyCollectedDataTypeCrashData",
      "NSPrivacyCollectedDataTypePerformanceData",
    ]) {
      expect(declared.has(unsupportedType), `${unsupportedType} has no native collection SDK`).toBe(false);
    }
  });

  it("keeps MetricKit file-timestamp access aligned with the main target manifest", () => {
    const manifest = manifestJson(appManifestPath);
    const source = fs.readFileSync(metricKitSourcePath, "utf8");
    const fileTimestamp = manifest.NSPrivacyAccessedAPITypes.find(
      (entry) => entry.NSPrivacyAccessedAPIType === "NSPrivacyAccessedAPICategoryFileTimestamp",
    );
    const sourceUsesFileTimestamp =
      source.includes("includingPropertiesForKeys: [.creationDateKey]") &&
      source.includes("resourceValues(forKeys: [.creationDateKey])");

    expect(fileTimestamp !== undefined).toBe(sourceUsesFileTimestamp);
    if (sourceUsesFileTimestamp) {
      expect(fileTimestamp?.NSPrivacyAccessedAPITypeReasons).toEqual(["C617.1"]);
    }
  });

  it("ships a kiosk-specific manifest with the required-reason and linked operational data", () => {
    const manifest = manifestJson(kioskManifestPath);
    const declared = new Map(manifest.NSPrivacyCollectedDataTypes.map((entry) => [entry.NSPrivacyCollectedDataType, entry]));
    const userDefaults = manifest.NSPrivacyAccessedAPITypes.find(
      (entry) => entry.NSPrivacyAccessedAPIType === "NSPrivacyAccessedAPICategoryUserDefaults",
    );

    expect(manifest.NSPrivacyTracking).toBe(false);
    expect(manifest.NSPrivacyTrackingDomains).toEqual([]);
    expect(userDefaults?.NSPrivacyAccessedAPITypeReasons).toEqual(["CA92.1"]);

    for (const type of [
      "NSPrivacyCollectedDataTypeName",
      "NSPrivacyCollectedDataTypeUserID",
      "NSPrivacyCollectedDataTypeDeviceID",
      "NSPrivacyCollectedDataTypeOtherUsageData",
      "NSPrivacyCollectedDataTypeOtherDiagnosticData",
    ]) {
      const entry = declared.get(type);
      expect(entry, `${type} should remain declared for the kiosk`).toBeDefined();
      expect(entry?.NSPrivacyCollectedDataTypeLinked).toBe(true);
      expect(entry?.NSPrivacyCollectedDataTypeTracking).toBe(false);
      expect(entry?.NSPrivacyCollectedDataTypePurposes).toEqual(["NSPrivacyCollectedDataTypePurposeAppFunctionality"]);
    }
  });
});
