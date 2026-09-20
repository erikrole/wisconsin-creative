/** Generate a random 6-digit numeric kiosk activation code. */
export function generateActivationCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const code = 100000 + (buf[0]! % 900000); // buf has exactly 1 element
  return code.toString();
}
