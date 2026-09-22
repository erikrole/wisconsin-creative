/** Preview/review delivery is isolated even if a provider variable is inherited accidentally. */
export function isPreviewEnvironment(): boolean {
  return process.env.WC_ENVIRONMENT === "preview" || process.env.WC_ENVIRONMENT === "review" || process.env.VERCEL_ENV === "preview";
}

export function isolatedIntegrationValue(key: string): string {
  if (isPreviewEnvironment() && !/^[a-f0-9]{20}$/.test(process.env.WC_PREVIEW_KEY || "")) return "";
  return (isPreviewEnvironment() ? process.env[`WC_PREVIEW_${key}`] : process.env[key]) || "";
}

export function cacheNamespace(productionPrefix: string): string {
  if (!isPreviewEnvironment()) return productionPrefix;
  const key = process.env.WC_PREVIEW_KEY;
  if (!key || !/^[a-f0-9]{20}$/.test(key)) return `wc-preview:unconfigured:${productionPrefix}`;
  return `wc-preview:${key}:${productionPrefix}`;
}
