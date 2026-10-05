import { env } from "@/lib/env";
import { createSecretBox } from "@/lib/secret-box";

const vault = createSecretBox({ readKey: () => env.softwareVaultKey, keyName: "SOFTWARE_VAULT_KEY", label: "software vault" });

/** Encrypt a vault field. The returned value contains no plaintext. */
export const encryptSoftwareSecret = (value: string): string => vault.encrypt(value);

/** Decrypt a vault field and fail closed for malformed or tampered data. */
export const decryptSoftwareSecret = (payload: string): string => vault.decrypt(payload);
