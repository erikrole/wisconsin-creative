/* Client-safe password form rules shared by the login, reset, and forced-change forms. */

const MIN_PASSWORD_LENGTH = 8;

export function validatePassword(password: string): string {
  if (!password) return "Password is required";
  if (password.length < MIN_PASSWORD_LENGTH) return `Must be at least ${MIN_PASSWORD_LENGTH} characters`;
  return "";
}

export function validatePasswordConfirmation(password: string, confirmation: string): string {
  if (!confirmation) return "Confirm your password";
  if (password !== confirmation) return "Passwords do not match";
  return "";
}
