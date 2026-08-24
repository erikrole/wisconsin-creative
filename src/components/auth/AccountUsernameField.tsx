"use client";

/**
 * The account identifier that belongs to an adjacent password field.
 *
 * A password manager saves and fills a credential as a pair. On a screen that
 * shows only a password box — the second step of sign-in, a forced change, the
 * Settings change-password form — there is nothing for it to pair with, so it
 * saves the password against no account or against the wrong one. This carries
 * the address without adding a second visible email box to the form.
 *
 * Kept visually hidden rather than `display: none`: managers skip fields that
 * are removed from layout entirely, and readonly plus `tabIndex={-1}` keeps it
 * out of the keyboard path.
 */
export function AccountUsernameField({ email, id = "account-username" }: { email: string; id?: string }) {
  if (!email) return null;
  return (
    <input
      id={id}
      type="text"
      name="username"
      autoComplete="username"
      value={email}
      readOnly
      tabIndex={-1}
      aria-hidden="true"
      className="sr-only"
      // Some managers re-scan on focus; nothing here should ever take it.
      onFocus={(event) => event.currentTarget.blur()}
    />
  );
}

/**
 * Safari and 1Password read this when generating a password, so the suggestion
 * satisfies the server's rule instead of being rejected after the fact. The
 * only server rule is a minimum of 8 characters.
 */
export const PASSWORD_RULES = "minlength: 8;";

/**
 * Spread onto a new-password input. React's DOM typings predate the
 * `passwordrules` attribute, so it is applied as a spread rather than a
 * declared prop; the browser still receives the plain attribute.
 */
export const passwordRulesAttribute: Record<string, string> = { passwordrules: PASSWORD_RULES };
