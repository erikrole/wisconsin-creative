function getRequired(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const env = {
  get databaseUrl() {
    return getRequired("DATABASE_URL");
  },
  get sessionSecret() {
    const secret = getRequired("SESSION_SECRET");
    if (secret.length < 32) {
      throw new Error("SESSION_SECRET must be at least 32 characters");
    }
    return secret;
  },
  get sessionCookieName() {
    return getRequired("SESSION_COOKIE_NAME");
  },
  /** Dedicated AES-256-GCM key for the shared software vault. */
  get softwareVaultKey() {
    return getRequired("SOFTWARE_VAULT_KEY");
  },
  get appTimezone() {
    return process.env.APP_TIMEZONE || "America/Chicago";
  },
  /** Optional — enables Vercel Cron auth for /api/cron/* routes */
  get cronSecret() {
    return process.env.CRON_SECRET || "";
  },
  /** Optional — enables email delivery via Resend. Falls back to console.log */
  get resendApiKey() {
    return process.env.RESEND_API_KEY || "";
  },
  /** From address for transactional email */
  get emailFrom() {
    return process.env.EMAIL_FROM || "Wisconsin Creative <noreply@wisconsincreative.com>";
  },
  /** Base URL for the app (used in emails). Falls back to VERCEL_URL or localhost. */
  get appUrl() {
    return process.env.APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  },
  /** WebAuthn relying-party name shown by the platform authenticator. */
  get passkeyRpName() {
    return process.env.PASSKEY_RP_NAME || "Wisconsin Creative";
  },
  /** WebAuthn relying-party ID. Configure explicitly for the production host. */
  get passkeyRpId() {
    return process.env.PASSKEY_RP_ID || new URL(this.appUrl).hostname;
  },
  /** Exact origins accepted by the WebAuthn ceremony verifier. */
  get passkeyOrigins() {
    const configured = process.env.PASSKEY_ORIGINS;
    const origins = configured
      ? configured.split(",").map((origin) => origin.trim()).filter(Boolean)
      : [this.appUrl];
    return [...new Set(origins)];
  },
  /** Optional — enables Sentry error tracking */
  get sentryDsn() {
    return process.env.SENTRY_DSN || "";
  },
  /** Optional — enables Vercel Blob image uploads */
  get blobReadWriteToken() {
    return process.env.BLOB_READ_WRITE_TOKEN || "";
  },
  /** Optional — required for authenticated Brand assets uploads/downloads. */
  get resourceAssetBlobReadWriteToken() {
    return process.env.RESOURCE_ASSET_BLOB_READ_WRITE_TOKEN || "";
  },
  /** Optional. Enables Brave-backed product image search */
  get braveSearchApiKey() {
    return process.env.BRAVE_SEARCH_API_KEY || "";
  },
  /**
   * Origins trusted for same-origin (CSRF) checks on mutating requests.
   * Derived from an explicit allowlist rather than request headers so a
   * proxy that forwards a client-controlled Host/x-forwarded-host can't be
   * used to forge an allowed Origin.
   *
   * Configure `TRUSTED_ORIGINS` as a comma-separated list to override.
   * Otherwise we fall back to APP_URL plus the known Wisconsin Creative
   * production hosts (canonical + legacy) so CSRF keeps working across the
   * domain cutover with zero required config.
   */
  get trustedOrigins(): string[] {
    const out = new Set<string>();
    const addOrigin = (value: string | undefined) => {
      if (!value) return;
      try {
        out.add(new URL(value).origin);
      } catch {
        // Ignore malformed entries rather than fail every mutation.
      }
    };

    const configured = process.env.TRUSTED_ORIGINS;
    if (configured) {
      for (const entry of configured.split(",")) addOrigin(entry.trim());
      return [...out];
    }

    addOrigin(process.env.APP_URL);
    addOrigin("https://wisconsincreative.com");
    addOrigin("https://gear.erikrole.com");
    return [...out];
  },
};
